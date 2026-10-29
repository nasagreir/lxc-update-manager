import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_AUTH, DEFAULT_STATE } from "@/lib/store/defaults";
import type { AppState } from "@/lib/types";

const DATA_DIR = process.env.LXC_UPDATER_DATA_DIR || path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

let writeQueue: Promise<void> = Promise.resolve();
let memoryCache: AppState | null = null;
/** mtimeMs of the last state we loaded or wrote — used to pick up CLI edits. */
let cacheMtimeMs = 0;

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function mergeState(raw: Partial<AppState> | null): AppState {
  const settings = { ...DEFAULT_STATE.settings, ...(raw?.settings ?? {}) };
  // Migrate legacy defaultNode → includeNodes when includeNodes is empty.
  if (!settings.includeNodes?.trim() && settings.defaultNode?.trim()) {
    settings.includeNodes = settings.defaultNode.trim();
  }
  if (settings.nodeSshHosts == null) {
    settings.nodeSshHosts = "";
  }
  const auth = { ...DEFAULT_AUTH, ...(raw?.auth ?? {}) };
  const automations = (raw?.automations ?? []).map((a) => ({
    ...a,
    checkBeforeRun: a.checkBeforeRun ?? false,
    onlyWhenUpdatesAvailable: a.onlyWhenUpdatesAvailable ?? false,
  }));
  const jobs = (raw?.jobs ?? []).map((j) => ({
    ...j,
    target: j.target ?? ("container" as const),
  }));
  return {
    settings,
    auth,
    automations,
    jobs,
    apiKeys: raw?.apiKeys ?? [],
    containerMeta: raw?.containerMeta ?? {},
    nodeMeta: raw?.nodeMeta ?? {},
  };
}

async function fileMtimeMs(): Promise<number | null> {
  try {
    const stat = await fs.stat(STATE_FILE);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

export async function readState(): Promise<AppState> {
  const mtime = await fileMtimeMs();
  if (memoryCache && mtime != null && mtime === cacheMtimeMs) {
    return structuredClone(memoryCache);
  }
  await ensureDataDir();
  try {
    const text = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(text) as Partial<AppState>;
    memoryCache = mergeState(parsed);
    cacheMtimeMs = (await fileMtimeMs()) ?? Date.now();
  } catch {
    memoryCache = structuredClone(DEFAULT_STATE);
    await writeState(memoryCache);
  }
  return structuredClone(memoryCache);
}

export async function writeState(state: AppState): Promise<void> {
  const snapshot = structuredClone(state);
  writeQueue = writeQueue.then(async () => {
    await ensureDataDir();
    // If the CT password CLI (or another process) updated state.json since we
    // last loaded it, keep the on-disk auth block instead of clobbering it.
    try {
      const stat = await fs.stat(STATE_FILE);
      if (stat.mtimeMs > cacheMtimeMs) {
        const disk = JSON.parse(await fs.readFile(STATE_FILE, "utf8")) as Partial<AppState>;
        if (disk.auth) {
          snapshot.auth = { ...DEFAULT_AUTH, ...disk.auth };
        }
      }
    } catch {
      // File may not exist yet on first boot.
    }
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
    await fs.rename(tmp, STATE_FILE);
    memoryCache = structuredClone(snapshot);
    cacheMtimeMs = (await fileMtimeMs()) ?? Date.now();
  });
  await writeQueue;
}

export async function updateState(
  updater: (state: AppState) => AppState | Promise<AppState>,
): Promise<AppState> {
  const current = await readState();
  const next = await updater(current);
  await writeState(next);
  return structuredClone(next);
}

export function getDataDir() {
  return DATA_DIR;
}
