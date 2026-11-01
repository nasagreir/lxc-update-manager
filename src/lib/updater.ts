import { randomUUID } from "crypto";
import { checkContainerUpdates } from "@/lib/proxmox/check-updates";
import { listContainers } from "@/lib/proxmox/client";
import {
  createPreUpdateSnapshot,
  preUpdateSnapshotName,
  rollbackSnapshot,
} from "@/lib/proxmox/snapshots";
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
  AppState,
  JobStatus,
  LxcContainer,
  TriggerSource,
  UpdateJob,
  UpdateMethod,
} from "@/lib/types";

type ContainerMeta = AppState["containerMeta"][string];

function emptyMeta(partial?: Partial<ContainerMeta>): ContainerMeta {
  return {
    updateMethod: partial?.updateMethod ?? "unknown",
    lastCheckedAt: partial?.lastCheckedAt ?? null,
    lastUpdatedAt: partial?.lastUpdatedAt ?? null,
    lastUpdateStatus: partial?.lastUpdateStatus ?? null,
    updateAvailable: partial?.updateAvailable ?? null,
    updateAvailableDetail: partial?.updateAvailableDetail ?? null,
    pendingUpdateCount: partial?.pendingUpdateCount ?? 0,
    notes: partial?.notes,
    lastSnapshotName: partial?.lastSnapshotName ?? null,
    lastSnapshotAt: partial?.lastSnapshotAt ?? null,
  };
}

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
      updateAvailable: m?.updateAvailable ?? mockSeed?.updateAvailable ?? null,
      updateAvailableDetail:
        m?.updateAvailableDetail ?? mockSeed?.updateAvailableDetail ?? null,
      pendingUpdateCount:
        m?.pendingUpdateCount ?? mockSeed?.pendingUpdateCount ?? 0,
      notes: m?.notes ?? mockSeed?.notes,
      lastSnapshotName: m?.lastSnapshotName ?? null,
      lastSnapshotAt: m?.lastSnapshotAt ?? null,
    };
  });
}

export async function getContainers(opts?: {
  refreshMethods?: boolean;
  checkUpdates?: boolean;
}): Promise<LxcContainer[]> {
  const state = await readState();
  const raw = await listContainers(state.settings);
  let containers = enrichContainers(raw, state.containerMeta, state.settings.mockMode);

  if (opts?.refreshMethods && !state.settings.mockMode) {
    for (const c of containers.filter((x) => x.status === "running")) {
      try {
        const method = await detectUpdateMethod(
          state.settings,
          c.vmid,
          c.node,
        );
        const checkedAt = new Date().toISOString();
        await updateState((s) => {
          const prev = s.containerMeta[String(c.vmid)];
          return {
            ...s,
            containerMeta: {
              ...s.containerMeta,
              [String(c.vmid)]: emptyMeta({
                ...prev,
                updateMethod: method,
                lastCheckedAt: checkedAt,
              }),
            },
          };
        });
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

  if (opts?.checkUpdates) {
    containers = await checkUpdatesForContainers(containers);
  }

  return containers;
}

/** Probe each running CT for pending updates and persist results. */
export async function checkUpdatesForContainers(
  existing?: LxcContainer[],
): Promise<LxcContainer[]> {
  const state = await readState();
  const containers = existing ?? (await getContainers());
  const targets = containers.filter(
    (c) => c.status === "running" && c.updateMethod !== "unknown",
  );

  for (const c of targets) {
    try {
      let method = c.updateMethod;
      if (method === "unknown" && !state.settings.mockMode) {
        method = await detectUpdateMethod(state.settings, c.vmid, c.node);
      }
      const result = await checkContainerUpdates(
        state.settings,
        c.vmid,
        method,
        c.node,
      );
      await updateState((s) => {
        const prev = s.containerMeta[String(c.vmid)];
        return {
          ...s,
          containerMeta: {
            ...s.containerMeta,
            [String(c.vmid)]: emptyMeta({
              ...prev,
              updateMethod: result.method,
              lastCheckedAt: result.checkedAt,
              updateAvailable: result.available,
              updateAvailableDetail: result.detail,
              pendingUpdateCount: result.pendingCount,
              notes: prev?.notes ?? c.notes,
            }),
          },
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateState((s) => {
        const prev = s.containerMeta[String(c.vmid)];
        return {
          ...s,
          containerMeta: {
            ...s.containerMeta,
            [String(c.vmid)]: emptyMeta({
              ...prev,
              lastCheckedAt: new Date().toISOString(),
              updateAvailable: prev?.updateAvailable ?? null,
              updateAvailableDetail: `Check failed: ${message}`,
              notes: prev?.notes ?? c.notes,
            }),
          },
        };
      });
    }
  }

  const refreshed = await readState();
  const raw = await listContainers(refreshed.settings);
  return enrichContainers(
    raw,
    refreshed.containerMeta,
    refreshed.settings.mockMode,
  );
}

type UpdateResult = {
  ok: boolean;
  method: UpdateMethod;
  snapshotName?: string | null;
  rolledBack?: boolean;
};

async function simulateMockUpdate(
  jobId: string,
  container: LxcContainer,
): Promise<UpdateResult> {
  const method = container.updateMethod;
  await appendJobLog(
    jobId,
    `[mock] Starting update for ${container.name} (${container.vmid}) via ${method}\n`,
  );
  const settings = (await readState()).settings;
  let snapshotName: string | null = null;
  if (settings.snapshotBeforeUpdate) {
    snapshotName = preUpdateSnapshotName();
    await appendJobLog(
      jobId,
      `[mock] Proxmox snapshot ${snapshotName} created on ${container.node}.\n`,
    );
  }
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
    return { ok: true, method, snapshotName };
  }
  if (method === "apt") {
    await appendJobLog(jobId, "  → apt-get update && dist-upgrade\n");
    await sleep(800);
    await appendJobLog(jobId, "  ✓ 3 packages upgraded\n");
    return { ok: true, method, snapshotName };
  }
  if (method === "apk") {
    await appendJobLog(jobId, "  → apk update && apk upgrade\n");
    await sleep(500);
    await appendJobLog(jobId, "  ✓ Alpine packages upgraded\n");
    return { ok: true, method, snapshotName };
  }
  await appendJobLog(
    jobId,
    "  ✗ No known update method for this container\n",
  );
  if (snapshotName) {
    await appendJobLog(
      jobId,
      `[mock] Rolling back to snapshot ${snapshotName}.\n`,
    );
  }
  return { ok: false, method, snapshotName, rolledBack: Boolean(snapshotName) };
}

async function rollbackFailedUpdate(
  jobId: string,
  container: LxcContainer,
  snapshotName: string,
): Promise<boolean> {
  await appendJobLog(
    jobId,
    `Update failed. Rolling back to Proxmox snapshot ${snapshotName}…\n`,
  );
  try {
    const settings = (await readState()).settings;
    await rollbackSnapshot(
      settings,
      container.node,
      container.vmid,
      snapshotName,
    );
    await appendJobLog(
      jobId,
      `Rolled back to ${snapshotName} and started the container.\n`,
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendJobLog(jobId, `✗ Rollback failed: ${message}\n`);
    return false;
  }
}

async function runRealUpdate(
  jobId: string,
  container: LxcContainer,
): Promise<UpdateResult> {
  const state = await readState();
  let method = container.updateMethod;

  if (method === "unknown") {
    await appendJobLog(jobId, "Detecting update method…\n");
    method = await detectUpdateMethod(
      state.settings,
      container.vmid,
      container.node,
    );
    await appendJobLog(jobId, `Detected: ${method}\n`);
  }

  if (container.status !== "running") {
    await appendJobLog(jobId, "Container is not running — cannot update.\n");
    return { ok: false, method };
  }

  let snapshotName: string | null = null;
  if (state.settings.snapshotBeforeUpdate) {
    await appendJobLog(
      jobId,
      `Creating Proxmox snapshot on ${container.node}…\n`,
    );
    try {
      snapshotName = await createPreUpdateSnapshot(
        state.settings,
        container.node,
        container.vmid,
        container.name,
      );
      await appendJobLog(
        jobId,
        `Snapshot ${snapshotName} created. A failed update will roll back to it.\n`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendJobLog(
        jobId,
        `✗ Proxmox snapshot failed: ${message}\nUpdate was not started. The API token needs VM.Snapshot, and the disk must be on snapshot-capable storage (ZFS, LVM-thin, Ceph, or btrfs). Turn off “Snapshot before update” in Settings if this storage cannot snapshot.\n`,
      );
      return { ok: false, method };
    }
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
    return { ok: false, method, snapshotName };
  }

  await appendJobLog(jobId, `Node: ${container.node}\n`);
  let result;
  try {
    result = await pctExec(
      state.settings,
      container.vmid,
      ["bash", "-lc", script],
      undefined,
      container.node,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendJobLog(jobId, `✗ ${message}\n`);
    const rolledBack = snapshotName
      ? await rollbackFailedUpdate(jobId, container, snapshotName)
      : false;
    return { ok: false, method, snapshotName, rolledBack };
  }

  if (result.stdout) await appendJobLog(jobId, result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  if (result.stderr) await appendJobLog(jobId, result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);

  if (result.timedOut) {
    await appendJobLog(jobId, "✗ Update timed out.\n");
    const rolledBack = snapshotName
      ? await rollbackFailedUpdate(jobId, container, snapshotName)
      : false;
    return { ok: false, method, snapshotName, rolledBack };
  }
  if ((result.code ?? 1) !== 0) {
    await appendJobLog(jobId, `✗ Exit code ${result.code}\n`);
    const rolledBack = snapshotName
      ? await rollbackFailedUpdate(jobId, container, snapshotName)
      : false;
    return { ok: false, method, snapshotName, rolledBack };
  }
  await appendJobLog(jobId, "✓ Update finished.\n");
  if (snapshotName) {
    await appendJobLog(
      jobId,
      `Snapshot ${snapshotName} was kept. Use Roll back on this container if the guest misbehaves.\n`,
    );
  }
  return { ok: true, method, snapshotName };
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
      target: "container",
      vmid,
      containerName: container.name,
      node: container.node,
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
  if (job.target === "node") return;

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
      error: result.ok
        ? undefined
        : result.rolledBack
          ? "Update failed. Rolled back to the Proxmox snapshot."
          : "Update failed — see log",
    });

    await updateState((s) => {
      const prev = s.containerMeta[String(job.vmid)];
      return {
        ...s,
        containerMeta: {
          ...s.containerMeta,
          [String(job.vmid)]: emptyMeta({
            ...prev,
            updateMethod: result.method,
            lastCheckedAt: finishedAt,
            lastUpdatedAt: result.ok
              ? finishedAt
              : prev?.lastUpdatedAt ?? null,
            lastUpdateStatus: status,
            // After a successful update, clear the badge until the next check.
            updateAvailable: result.ok ? false : prev?.updateAvailable ?? null,
            updateAvailableDetail: result.ok
              ? "Up to date"
              : prev?.updateAvailableDetail ?? null,
            pendingUpdateCount: result.ok ? 0 : prev?.pendingUpdateCount ?? 0,
            notes: prev?.notes ?? container.notes,
            lastSnapshotName:
              result.snapshotName ?? prev?.lastSnapshotName ?? null,
            lastSnapshotAt: result.snapshotName
              ? finishedAt
              : prev?.lastSnapshotAt ?? null,
          }),
        },
      };
    });
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

/** Roll a guest back to the Proxmox snapshot taken before its last update. */
export async function rollbackContainer(vmid: number): Promise<{
  snapshotName: string;
  jobId: string;
}> {
  const state = await readState();
  const containers = await getContainers();
  const container = containers.find((c) => c.vmid === vmid);
  if (!container) throw new Error("Container not found");
  const snapshotName = container.lastSnapshotName;
  if (!snapshotName) {
    throw new Error("No pre-update snapshot is recorded for this container");
  }
  if (runningVmids.has(vmid)) {
    throw new Error("An update is already running for this container");
  }

  const job: UpdateJob = {
    id: randomUUID(),
    target: "container",
    vmid,
    containerName: container.name,
    node: container.node,
    status: "running",
    trigger: "manual",
    updateMethod: container.updateMethod,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    log: `Rolling back ${container.name} (${vmid}) to Proxmox snapshot ${snapshotName}…\n`,
  };
  await updateState((s) => ({
    ...s,
    jobs: [job, ...s.jobs].slice(0, 200),
  }));

  runningVmids.add(vmid);
  try {
    if (state.settings.mockMode) {
      await appendJobLog(
        job.id,
        `[mock] Restored snapshot ${snapshotName} and started the container.\n`,
      );
    } else {
      await rollbackSnapshot(
        state.settings,
        container.node,
        vmid,
        snapshotName,
      );
      await appendJobLog(
        job.id,
        `Rolled back to ${snapshotName} and started the container.\n`,
      );
    }
    await patchJob(job.id, {
      status: "succeeded",
      finishedAt: new Date().toISOString(),
    });
    return { snapshotName, jobId: job.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendJobLog(job.id, `✗ ${message}\n`);
    await patchJob(job.id, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: message,
    });
    throw err;
  } finally {
    runningVmids.delete(vmid);
  }
}
