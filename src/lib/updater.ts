import { randomUUID } from "crypto";
import { listContainers } from "@/lib/proxmox/client";
import {
  buildApkUpdateScript,
  buildAptUpdateScript,
  buildCommunityUpdateScript,
  detectUpdateMethod,
  pctExec,
} from "@/lib/proxmox/exec";
import { MOCK_CONTAINERS } from "@/lib/store/defaults";
import { readState, updateState } from "@/lib/store/db";
import type {
  JobStatus,
  LxcContainer,
  TriggerSource,
  UpdateJob,
  UpdateMethod,
} from "@/lib/types";

const runningVmids = new Set<number>();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function appendJobLog(jobId: string, chunk: string) {
  await updateState((state) => {
    const jobs = state.jobs.map((j) =>
      j.id === jobId ? { ...j, log: `${j.log}${chunk}` } : j,
    );
    return { ...state, jobs };
  });
}

async function patchJob(
  jobId: string,
  patch: Partial<UpdateJob>,
): Promise<UpdateJob | null> {
  let updated: UpdateJob | null = null;
  await updateState((state) => {
    const jobs = state.jobs.map((j) => {
      if (j.id !== jobId) return j;
      updated = { ...j, ...patch };
      return updated;
    });
    return { ...state, jobs };
  });
  return updated;
}

function enrichContainers(
  raw: Awaited<ReturnType<typeof listContainers>>,
  meta: Awaited<ReturnType<typeof readState>>["containerMeta"],
  mock: boolean,
): LxcContainer[] {
  return raw.map((c) => {
    const key = String(c.vmid);
    const m = meta[key];
    const mockSeed = mock
      ? MOCK_CONTAINERS.find((x) => x.vmid === c.vmid)
      : undefined;
    return {
      ...c,
      updateMethod: m?.updateMethod ?? mockSeed?.updateMethod ?? "unknown",
      lastCheckedAt: m?.lastCheckedAt ?? null,
      lastUpdatedAt: m?.lastUpdatedAt ?? null,
      lastUpdateStatus: m?.lastUpdateStatus ?? null,
      notes: m?.notes ?? mockSeed?.notes,
    };
  });
}

export async function getContainers(opts?: {
  refreshMethods?: boolean;
}): Promise<LxcContainer[]> {
  const state = await readState();
  const raw = await listContainers(state.settings);
  let containers = enrichContainers(raw, state.containerMeta, state.settings.mockMode);

  if (opts?.refreshMethods && !state.settings.mockMode) {
    for (const c of containers.filter((x) => x.status === "running")) {
      try {
        const method = await detectUpdateMethod(state.settings, c.vmid);
        const checkedAt = new Date().toISOString();
        await updateState((s) => ({
          ...s,
          containerMeta: {
            ...s.containerMeta,
            [String(c.vmid)]: {
              updateMethod: method,
              lastCheckedAt: checkedAt,
              lastUpdatedAt: s.containerMeta[String(c.vmid)]?.lastUpdatedAt ?? null,
              lastUpdateStatus:
                s.containerMeta[String(c.vmid)]?.lastUpdateStatus ?? null,
              notes: s.containerMeta[String(c.vmid)]?.notes,
            },
          },
        }));
      } catch {
        // keep previous meta on detection failure
      }
    }
    const refreshed = await readState();
    containers = enrichContainers(
      raw,
      refreshed.containerMeta,
      refreshed.settings.mockMode,
    );
  }

  return containers;
}

async function simulateMockUpdate(
  jobId: string,
  container: LxcContainer,
): Promise<{ ok: boolean; method: UpdateMethod }> {
  const method = container.updateMethod;
  await appendJobLog(
    jobId,
    `[mock] Starting update for ${container.name} (${container.vmid}) via ${method}\n`,
  );
  await sleep(400);
  if (method === "community-script") {
    await appendJobLog(
      jobId,
      "  ✓ Community script update command found\n",
    );
    await appendJobLog(jobId, "  → Feeding interactive prompts (y/y/y…)\n");
    await sleep(500);
    await appendJobLog(jobId, "  → Downloading latest helper script…\n");
    await sleep(600);
    await appendJobLog(jobId, "  → Applying package and app updates…\n");
    await sleep(700);
    await appendJobLog(jobId, "  ✓ Update completed successfully\n");
    return { ok: true, method };
  }
  if (method === "apt") {
    await appendJobLog(jobId, "  → apt-get update && dist-upgrade\n");
    await sleep(800);
    await appendJobLog(jobId, "  ✓ 3 packages upgraded\n");
    return { ok: true, method };
  }
  if (method === "apk") {
    await appendJobLog(jobId, "  → apk update && apk upgrade\n");
    await sleep(500);
    await appendJobLog(jobId, "  ✓ Alpine packages upgraded\n");
    return { ok: true, method };
  }
  await appendJobLog(
    jobId,
    "  ✗ No known update method for this container\n",
  );
  return { ok: false, method };
}

async function runRealUpdate(
  jobId: string,
  container: LxcContainer,
): Promise<{ ok: boolean; method: UpdateMethod }> {
  const state = await readState();
  let method = container.updateMethod;

  if (method === "unknown") {
    await appendJobLog(jobId, "Detecting update method…\n");
    method = await detectUpdateMethod(state.settings, container.vmid);
    await appendJobLog(jobId, `Detected: ${method}\n`);
  }

  if (container.status !== "running") {
    await appendJobLog(jobId, "Container is not running — cannot update.\n");
    return { ok: false, method };
  }

  let script: string;
  if (method === "community-script") {
    script = buildCommunityUpdateScript(
      state.settings.communityScriptAnswers,
    );
    await appendJobLog(
      jobId,
      "Running community helper-script `update` (non-interactive answers on stdin)…\n",
    );
  } else if (method === "apt") {
    script = buildAptUpdateScript();
    await appendJobLog(jobId, "Running apt dist-upgrade…\n");
  } else if (method === "apk") {
    script = buildApkUpdateScript();
    await appendJobLog(jobId, "Running apk upgrade…\n");
  } else {
    await appendJobLog(jobId, "No supported update method.\n");
    return { ok: false, method };
  }

  const result = await pctExec(state.settings, container.vmid, [
    "bash",
    "-lc",
    script,
  ]);

  if (result.stdout) await appendJobLog(jobId, result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  if (result.stderr) await appendJobLog(jobId, result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);

  if (result.timedOut) {
    await appendJobLog(jobId, "✗ Update timed out.\n");
    return { ok: false, method };
  }
  if ((result.code ?? 1) !== 0) {
    await appendJobLog(jobId, `✗ Exit code ${result.code}\n`);
    return { ok: false, method };
  }
  await appendJobLog(jobId, "✓ Update finished.\n");
  return { ok: true, method };
}

export async function enqueueUpdates(opts: {
  vmids: number[];
  trigger: TriggerSource;
  automationId?: string;
  staggerSeconds?: number;
}): Promise<UpdateJob[]> {
  const containers = await getContainers();
  const byId = new Map(containers.map((c) => [c.vmid, c]));
  const created: UpdateJob[] = [];

  for (const vmid of opts.vmids) {
    const container = byId.get(vmid);
    if (!container) continue;

    const job: UpdateJob = {
      id: randomUUID(),
      vmid,
      containerName: container.name,
      status: "queued",
      trigger: opts.trigger,
      automationId: opts.automationId,
      updateMethod: container.updateMethod,
      startedAt: null,
      finishedAt: null,
      log: "",
    };
    created.push(job);
  }

  if (created.length === 0) return [];

  await updateState((state) => ({
    ...state,
    jobs: [...created, ...state.jobs].slice(0, 200),
  }));

  // Fire-and-forget worker chain
  void processQueue(created.map((j) => j.id), opts.staggerSeconds ?? 0);

  return created;
}

async function processQueue(jobIds: string[], staggerSeconds: number) {
  for (let i = 0; i < jobIds.length; i++) {
    if (i > 0 && staggerSeconds > 0) {
      await sleep(staggerSeconds * 1000);
    }
    await runJob(jobIds[i]!);
  }
}

async function runJob(jobId: string) {
  const state = await readState();
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job || job.status === "cancelled") return;

  if (runningVmids.has(job.vmid)) {
    await patchJob(jobId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: "Another update is already running for this container.",
      log: `${job.log}Skipped: update already in progress.\n`,
    });
    return;
  }

  runningVmids.add(job.vmid);
  await patchJob(jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
  });

  try {
    const containers = await getContainers();
    const container = containers.find((c) => c.vmid === job.vmid);
    if (!container) {
      await patchJob(jobId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: "Container not found",
      });
      return;
    }

    const settings = (await readState()).settings;
    const result = settings.mockMode
      ? await simulateMockUpdate(jobId, container)
      : await runRealUpdate(jobId, container);

    const status: JobStatus = result.ok ? "succeeded" : "failed";
    const finishedAt = new Date().toISOString();
    await patchJob(jobId, {
      status,
      finishedAt,
      updateMethod: result.method,
      error: result.ok ? undefined : "Update failed — see log",
    });

    await updateState((s) => ({
      ...s,
      containerMeta: {
        ...s.containerMeta,
        [String(job.vmid)]: {
          updateMethod: result.method,
          lastCheckedAt: finishedAt,
          lastUpdatedAt: result.ok
            ? finishedAt
            : s.containerMeta[String(job.vmid)]?.lastUpdatedAt ?? null,
          lastUpdateStatus: status,
          notes: s.containerMeta[String(job.vmid)]?.notes ?? container.notes,
        },
      },
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendJobLog(jobId, `✗ ${message}\n`);
    await patchJob(jobId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: message,
    });
  } finally {
    runningVmids.delete(job.vmid);
  }
}

export async function getJobs(): Promise<UpdateJob[]> {
  const state = await readState();
  return state.jobs;
}

export async function getJob(id: string): Promise<UpdateJob | undefined> {
  const state = await readState();
  return state.jobs.find((j) => j.id === id);
}
