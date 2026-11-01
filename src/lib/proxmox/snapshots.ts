import { pveRequest } from "@/lib/proxmox/client";
import type { AppSettings } from "@/lib/types";

/** Proxmox snapshot ids: start with a letter, then letters, digits, underscore. */
const SNAPSHOT_NAME = /^[a-z][a-z0-9_]+$/i;
const SNAPSHOT_PREFIX = "lxcu";

export interface PveSnapshot {
  name: string;
  description?: string;
  snaptime?: number;
}

interface PveTask {
  status?: string;
  exitstatus?: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function preUpdateSnapshotName(now = Date.now()): string {
  const stamp = Math.floor(now / 1000).toString(36);
  return `${SNAPSHOT_PREFIX}${stamp}`.slice(0, 40);
}

export function isUpdaterSnapshot(name: string): boolean {
  return name.startsWith(SNAPSHOT_PREFIX) && SNAPSHOT_NAME.test(name);
}

function lxcPath(node: string, vmid: number, rest = ""): string {
  return `/nodes/${encodeURIComponent(node)}/lxc/${vmid}${rest}`;
}

export async function listSnapshots(
  settings: AppSettings,
  node: string,
  vmid: number,
): Promise<PveSnapshot[]> {
  const rows = await pveRequest<PveSnapshot[]>(
    settings,
    lxcPath(node, vmid, "/snapshot"),
  );
  return (rows ?? []).filter((row) => row.name && row.name !== "current");
}

async function waitForTask(
  settings: AppSettings,
  node: string,
  upid: string,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 10 * 60 * 1000;
  const path = `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`;
  while (Date.now() < deadline) {
    const task = await pveRequest<PveTask>(settings, path);
    if (task.status === "stopped") {
      if (task.exitstatus && task.exitstatus !== "OK") {
        throw new Error(`${label} failed: ${task.exitstatus}`);
      }
      return;
    }
    await sleep(1000);
  }
  throw new Error(`${label} timed out waiting for Proxmox task ${upid}`);
}

async function runTask(
  settings: AppSettings,
  node: string,
  pathname: string,
  label: string,
  init?: { method?: "POST" | "DELETE"; form?: Record<string, string> },
): Promise<void> {
  const upid = await pveRequest<string>(settings, pathname, {
    method: init?.method ?? "POST",
    form: init?.form,
  });
  if (typeof upid === "string" && upid.startsWith("UPID:")) {
    await waitForTask(settings, node, upid, label);
  }
}

/**
 * Native Proxmox LXC snapshot (`POST …/lxc/{vmid}/snapshot`).
 * Removes older lxcu* snapshots once the new one exists.
 */
export async function createPreUpdateSnapshot(
  settings: AppSettings,
  node: string,
  vmid: number,
  containerName: string,
): Promise<string> {
  const snapname = preUpdateSnapshotName();
  if (!SNAPSHOT_NAME.test(snapname)) {
    throw new Error(`Invalid snapshot name ${snapname}`);
  }
  await runTask(
    settings,
    node,
    lxcPath(node, vmid, "/snapshot"),
    `Snapshot ${snapname}`,
    {
      method: "POST",
      form: {
        snapname,
        description: `LXC Updater pre-update snapshot of ${containerName} (${vmid})`,
      },
    },
  );

  try {
    const existing = await listSnapshots(settings, node, vmid);
    for (const snap of existing) {
      if (snap.name === snapname || !isUpdaterSnapshot(snap.name)) continue;
      await runTask(
        settings,
        node,
        lxcPath(node, vmid, `/snapshot/${encodeURIComponent(snap.name)}`),
        `Delete snapshot ${snap.name}`,
        { method: "DELETE" },
      );
    }
  } catch {
    // The new snapshot is the one we can roll back to. Old copies can stay.
  }

  return snapname;
}

/** Roll the CT back to a snapshot, then start it again. */
export async function rollbackSnapshot(
  settings: AppSettings,
  node: string,
  vmid: number,
  snapname: string,
): Promise<void> {
  if (!SNAPSHOT_NAME.test(snapname) || snapname === "current") {
    throw new Error(`Refusing to roll back to snapshot “${snapname}”`);
  }
  await runTask(
    settings,
    node,
    lxcPath(
      node,
      vmid,
      `/snapshot/${encodeURIComponent(snapname)}/rollback`,
    ),
    `Rollback ${snapname}`,
  );
  await runTask(
    settings,
    node,
    lxcPath(node, vmid, "/status/start"),
    `Start CT ${vmid}`,
  );
}
