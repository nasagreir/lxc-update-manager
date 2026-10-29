import { randomUUID } from "crypto";
import { checkHostUpdates } from "@/lib/proxmox/check-updates";
import { listNodeInventory } from "@/lib/proxmox/client";
import { buildHostAptUpdateScript, hostExec } from "@/lib/proxmox/exec";
import { resolveSshHostForNode } from "@/lib/proxmox/nodes";
import { readState, updateState } from "@/lib/store/db";
import type {
  AppState,
  JobStatus,
  ProxmoxNode,
  TriggerSource,
  UpdateJob,
} from "@/lib/types";

type NodeMeta = AppState["nodeMeta"][string];

function emptyNodeMeta(partial?: Partial<NodeMeta>): NodeMeta {
  return {
    lastCheckedAt: partial?.lastCheckedAt ?? null,
    lastUpdatedAt: partial?.lastUpdatedAt ?? null,
    lastUpdateStatus: partial?.lastUpdateStatus ?? null,
    updateAvailable: partial?.updateAvailable ?? null,
    updateAvailableDetail: partial?.updateAvailableDetail ?? null,
    pendingUpdateCount: partial?.pendingUpdateCount ?? 0,
  };
}

const runningNodes = new Set<string>();

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

function enrichNodes(
  inventory: Awaited<ReturnType<typeof listNodeInventory>>,
  meta: AppState["nodeMeta"],
): ProxmoxNode[] {
  return inventory.map((n) => {
    const m = meta[n.name];
    return {
      name: n.name,
      status: n.status,
      sshHost: n.sshHost,
      lastCheckedAt: m?.lastCheckedAt ?? null,
      lastUpdatedAt: m?.lastUpdatedAt ?? null,
      lastUpdateStatus: m?.lastUpdateStatus ?? null,
      updateAvailable: m?.updateAvailable ?? null,
      updateAvailableDetail: m?.updateAvailableDetail ?? null,
      pendingUpdateCount: m?.pendingUpdateCount ?? 0,
    };
  });
}

export async function getNodes(opts?: {
  checkUpdates?: boolean;
}): Promise<ProxmoxNode[]> {
  const state = await readState();
  let nodes = enrichNodes(
    await listNodeInventory(state.settings),
    state.nodeMeta,
  );

  if (opts?.checkUpdates) {
    nodes = await checkUpdatesForNodes(nodes);
  }

  return nodes;
}

/** Probe each Proxmox host for pending apt updates and persist results. */
export async function checkUpdatesForNodes(
  existing?: ProxmoxNode[],
): Promise<ProxmoxNode[]> {
  const state = await readState();
  const nodes = existing ?? (await getNodes());

  for (const node of nodes) {
    try {
      const result = await checkHostUpdates(state.settings, node.name);
      await updateState((s) => ({
        ...s,
        nodeMeta: {
          ...s.nodeMeta,
          [node.name]: emptyNodeMeta({
            ...s.nodeMeta[node.name],
            lastCheckedAt: result.checkedAt,
            updateAvailable: result.available,
            updateAvailableDetail: result.detail,
            pendingUpdateCount: result.pendingCount,
          }),
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateState((s) => ({
        ...s,
        nodeMeta: {
          ...s.nodeMeta,
          [node.name]: emptyNodeMeta({
            ...s.nodeMeta[node.name],
            lastCheckedAt: new Date().toISOString(),
            updateAvailable: s.nodeMeta[node.name]?.updateAvailable ?? null,
            updateAvailableDetail: `Check failed: ${message}`,
          }),
        },
      }));
    }
  }

  const refreshed = await readState();
  return enrichNodes(
    await listNodeInventory(refreshed.settings),
    refreshed.nodeMeta,
  );
}

async function simulateMockNodeUpdate(
  jobId: string,
  node: ProxmoxNode,
): Promise<boolean> {
  await appendJobLog(
    jobId,
    `[mock] Starting host system update on ${node.name} (${node.sshHost})\n`,
  );
  await sleep(400);
  await appendJobLog(jobId, "  → apt-get update\n");
  await sleep(500);
  await appendJobLog(jobId, "  → apt-get dist-upgrade\n");
  await sleep(700);
  const count = node.pendingUpdateCount || 4;
  await appendJobLog(
    jobId,
    `  ✓ ${count} host package(s) upgraded on ${node.name}\n`,
  );
  return true;
}

async function runRealNodeUpdate(
  jobId: string,
  node: ProxmoxNode,
): Promise<boolean> {
  const state = await readState();
  const sshHost = resolveSshHostForNode(state.settings, node.name);

  await appendJobLog(
    jobId,
    `Updating Proxmox host ${node.name} via SSH ${state.settings.sshUser}@${sshHost}\n`,
  );
  await appendJobLog(jobId, "Running host apt dist-upgrade…\n");

  const script = buildHostAptUpdateScript();
  const result = await hostExec(state.settings, node.name, [
    "bash",
    "-lc",
    script,
  ]);

  if (result.stdout) {
    await appendJobLog(
      jobId,
      result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`,
    );
  }
  if (result.stderr) {
    await appendJobLog(
      jobId,
      result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`,
    );
  }

  if (result.timedOut) {
    await appendJobLog(jobId, "✗ Host update timed out.\n");
    return false;
  }
  if ((result.code ?? 1) !== 0) {
    await appendJobLog(jobId, `✗ Exit code ${result.code}\n`);
    return false;
  }
  await appendJobLog(jobId, `✓ Host ${node.name} update finished.\n`);
  return true;
}

export async function enqueueNodeUpdates(opts: {
  nodes: string[];
  trigger: TriggerSource;
  staggerSeconds?: number;
}): Promise<UpdateJob[]> {
  const cluster = await getNodes();
  const byName = new Map(cluster.map((n) => [n.name, n]));
  const created: UpdateJob[] = [];

  for (const name of opts.nodes) {
    const node = byName.get(name);
    if (!node) continue;

    const job: UpdateJob = {
      id: randomUUID(),
      target: "node",
      vmid: 0,
      containerName: `node/${node.name}`,
      node: node.name,
      status: "queued",
      trigger: opts.trigger,
      updateMethod: "apt",
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

  void processNodeQueue(created.map((j) => j.id), opts.staggerSeconds ?? 0);
  return created;
}

async function processNodeQueue(jobIds: string[], staggerSeconds: number) {
  for (let i = 0; i < jobIds.length; i++) {
    if (i > 0 && staggerSeconds > 0) {
      await sleep(staggerSeconds * 1000);
    }
    await runNodeJob(jobIds[i]!);
  }
}

async function runNodeJob(jobId: string) {
  const state = await readState();
  const job = state.jobs.find((j) => j.id === jobId);
  if (!job || job.status === "cancelled") return;

  const nodeName = job.node;
  if (!nodeName) {
    await patchJob(jobId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: "Node name missing on job",
    });
    return;
  }

  if (runningNodes.has(nodeName)) {
    await patchJob(jobId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: "Another host update is already running for this node.",
      log: `${job.log}Skipped: host update already in progress on ${nodeName}.\n`,
    });
    return;
  }

  runningNodes.add(nodeName);
  await patchJob(jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
  });

  try {
    const nodes = await getNodes();
    const node = nodes.find((n) => n.name === nodeName);
    if (!node) {
      await patchJob(jobId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: "Node not found",
      });
      return;
    }

    const settings = (await readState()).settings;
    const ok = settings.mockMode
      ? await simulateMockNodeUpdate(jobId, node)
      : await runRealNodeUpdate(jobId, node);

    const status: JobStatus = ok ? "succeeded" : "failed";
    const finishedAt = new Date().toISOString();
    await patchJob(jobId, {
      status,
      finishedAt,
      error: ok ? undefined : "Host update failed — see log",
    });

    await updateState((s) => ({
      ...s,
      nodeMeta: {
        ...s.nodeMeta,
        [nodeName]: emptyNodeMeta({
          ...s.nodeMeta[nodeName],
          lastCheckedAt: finishedAt,
          lastUpdatedAt: ok
            ? finishedAt
            : s.nodeMeta[nodeName]?.lastUpdatedAt ?? null,
          lastUpdateStatus: status,
          updateAvailable: ok
            ? false
            : s.nodeMeta[nodeName]?.updateAvailable ?? null,
          updateAvailableDetail: ok
            ? "Host apt up to date"
            : s.nodeMeta[nodeName]?.updateAvailableDetail ?? null,
          pendingUpdateCount: ok
            ? 0
            : s.nodeMeta[nodeName]?.pendingUpdateCount ?? 0,
        }),
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
    runningNodes.delete(nodeName);
  }
}
