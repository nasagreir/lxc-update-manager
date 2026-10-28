import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_STATE } from "@/lib/store/defaults";
import type { AppState } from "@/lib/types";

const DATA_DIR = process.env.LXC_UPDATER_DATA_DIR || path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

let writeQueue: Promise<void> = Promise.resolve();
let memoryCache: AppState | null = null;

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
  return {
    settings,
    automations: raw?.automations ?? [],
    jobs: raw?.jobs ?? [],
    containerMeta: raw?.containerMeta ?? {},
  };
}

export async function readState(): Promise<AppState> {
  if (memoryCache) return structuredClone(memoryCache);
  await ensureDataDir();
  try {
    const text = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(text) as Partial<AppState>;
    memoryCache = mergeState(parsed);
  } catch {
    memoryCache = structuredClone(DEFAULT_STATE);
    await writeState(memoryCache);
  }
  return structuredClone(memoryCache);
}

export async function writeState(state: AppState): Promise<void> {
  memoryCache = structuredClone(state);
  const snapshot = structuredClone(state);
  writeQueue = writeQueue.then(async () => {
    await ensureDataDir();
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
    await fs.rename(tmp, STATE_FILE);
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
