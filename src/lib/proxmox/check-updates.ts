import { hostExec, pctExec } from "@/lib/proxmox/exec";
import { MOCK_NODE_UPDATES } from "@/lib/store/defaults";
import type { AppSettings, UpdateMethod } from "@/lib/types";

export interface UpdateAvailability {
  available: boolean;
  /** Human-readable reason shown in the UI tooltip. */
  detail: string;
  /** Pending package / commit count when known. */
  pendingCount: number;
  checkedAt: string;
  method: UpdateMethod;
}

/**
 * Probe script run inside each CT.
 *
 * Strategy:
 * - apt: refresh indexes, count packages an apt dist-upgrade would install
 * - apk: refresh indexes, count packages from `apk version -l '<'`
 * - community-script (Debian helper-script CTs):
 *     1) apt pending packages (OS / shared deps)
 *     2) any /opt/* git checkout whose upstream is ahead of HEAD
 *
 * Prints a single machine line:
 *   RESULT|<available 0|1>|<pendingCount>|<detail>
 */
function buildProbeScript(method: UpdateMethod): string {
  if (method === "apk") {
    return [
      "set +e",
      "apk update -q >/dev/null 2>&1",
      "n=$(apk version -l '<' 2>/dev/null | grep -c . || true)",
      'n=${n:-0}',
      'if [ "$n" -gt 0 ]; then echo "RESULT|1|$n|$n apk package(s) upgradable"; else echo "RESULT|0|0|apk up to date"; fi',
    ].join("; ");
  }

  if (method === "apt") {
    return [
      "set +e",
      "export DEBIAN_FRONTEND=noninteractive",
      "apt-get update -qq >/dev/null 2>&1",
      "n=$(apt-get -s -o Debug::NoLocking=1 dist-upgrade 2>/dev/null | grep -c '^Inst ' || true)",
      'n=${n:-0}',
      'if [ "$n" -gt 0 ]; then echo "RESULT|1|$n|$n apt package(s) upgradable"; else echo "RESULT|0|0|apt up to date"; fi',
    ].join("; ");
  }

  if (method === "community-script") {
    // Bash probe as a plain string (avoid TS template interpolation).
    return [
      "set +e",
      "export DEBIAN_FRONTEND=noninteractive",
      "apt-get update -qq >/dev/null 2>&1",
      "apt_n=$(apt-get -s -o Debug::NoLocking=1 dist-upgrade 2>/dev/null | grep -c '^Inst ' || true)",
      'apt_n=${apt_n:-0}',
      "git_n=0",
      'while IFS= read -r gitdir; do',
      '  [ -z "$gitdir" ] && continue',
      '  repo=$(dirname "$gitdir")',
      '  git -C "$repo" remote get-url origin >/dev/null 2>&1 || continue',
      '  git -C "$repo" fetch --quiet --depth 1 origin 2>/dev/null || continue',
      '  branch=$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)',
      '  ahead=$(git -C "$repo" rev-list --count "HEAD..origin/${branch}" 2>/dev/null)',
      '  [ -z "$ahead" ] && ahead=$(git -C "$repo" rev-list --count HEAD..origin/main 2>/dev/null)',
      '  [ -z "$ahead" ] && ahead=$(git -C "$repo" rev-list --count HEAD..origin/master 2>/dev/null)',
      '  ahead=${ahead:-0}',
      '  git_n=$((git_n + ahead))',
      "done < <(find /opt -mindepth 2 -maxdepth 3 -type d -name .git 2>/dev/null | head -n 20)",
      "n=$((apt_n + git_n))",
      'parts=""',
      '[ "$apt_n" -gt 0 ] && parts="${parts}${parts:+; }${apt_n} apt package(s)"',
      '[ "$git_n" -gt 0 ] && parts="${parts}${parts:+; }${git_n} git commit(s) behind"',
      'if [ "$n" -gt 0 ]; then echo "RESULT|1|$n|$parts"; else echo "RESULT|0|0|no apt or git updates detected"; fi',
    ].join("\n");
  }

  return 'echo "RESULT|0|0|no update method"';
}

function parseProbeOutput(
  stdout: string,
): Omit<UpdateAvailability, "checkedAt" | "method"> {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const result = [...lines].reverse().find((l) => l.startsWith("RESULT|"));
  if (!result) {
    return {
      available: false,
      pendingCount: 0,
      detail: "Could not determine update status",
    };
  }
  const parts = result.split("|");
  const available = parts[1] === "1";
  const pendingCount = Number(parts[2] || 0) || 0;
  const detail =
    parts.slice(3).join("|") ||
    (available ? "Updates available" : "Up to date");
  return { available, pendingCount, detail };
}

/** Deterministic mock availability for demo mode. */
export function mockAvailability(
  vmid: number,
  method: UpdateMethod,
): UpdateAvailability {
  const checkedAt = new Date().toISOString();
  const needing = new Set([101, 103, 110]);
  if (method === "unknown") {
    return {
      available: false,
      detail: "No update method",
      pendingCount: 0,
      checkedAt,
      method,
    };
  }
  if (needing.has(vmid)) {
    const detail =
      method === "community-script"
        ? "3 apt package(s); helper script may also have app updates"
        : method === "apk"
          ? "2 apk package(s) upgradable"
          : "5 apt package(s) upgradable";
    return {
      available: true,
      detail,
      pendingCount: method === "apk" ? 2 : method === "apt" ? 5 : 3,
      checkedAt,
      method,
    };
  }
  return {
    available: false,
    detail: "Up to date",
    pendingCount: 0,
    checkedAt,
    method,
  };
}

export async function checkContainerUpdates(
  settings: AppSettings,
  vmid: number,
  method: UpdateMethod,
  node?: string,
): Promise<UpdateAvailability> {
  const checkedAt = new Date().toISOString();

  if (settings.mockMode) {
    return mockAvailability(vmid, method);
  }

  if (method === "unknown") {
    return {
      available: false,
      detail: "No update method",
      pendingCount: 0,
      checkedAt,
      method,
    };
  }

  const script = buildProbeScript(method);
  const result = await pctExec(
    settings,
    vmid,
    ["bash", "-lc", script],
    180,
    node,
  );

  if (result.timedOut) {
    return {
      available: false,
      detail: "Update check timed out",
      pendingCount: 0,
      checkedAt,
      method,
    };
  }

  const parsed = parseProbeOutput(result.stdout);
  return { ...parsed, checkedAt, method };
}

function buildHostAptProbeScript(): string {
  return [
    "set +e",
    "export DEBIAN_FRONTEND=noninteractive",
    "apt-get update -qq >/dev/null 2>&1",
    "n=$(apt-get -s -o Debug::NoLocking=1 dist-upgrade 2>/dev/null | grep -c '^Inst ' || true)",
    'n=${n:-0}',
    'if [ "$n" -gt 0 ]; then echo "RESULT|1|$n|$n apt package(s) upgradable on host"; else echo "RESULT|0|0|Host apt up to date"; fi',
  ].join("; ");
}

/** Deterministic mock host availability for demo mode. */
export function mockNodeAvailability(node: string): UpdateAvailability {
  const checkedAt = new Date().toISOString();
  const seed = MOCK_NODE_UPDATES[node];
  if (seed) {
    return {
      available: seed.available,
      detail: seed.detail,
      pendingCount: seed.pendingCount,
      checkedAt,
      method: "apt",
    };
  }
  return {
    available: false,
    detail: "Host apt up to date",
    pendingCount: 0,
    checkedAt,
    method: "apt",
  };
}

/** Probe apt updates on the Proxmox host OS for a specific node. */
export async function checkHostUpdates(
  settings: AppSettings,
  node: string,
): Promise<UpdateAvailability> {
  const checkedAt = new Date().toISOString();

  if (settings.mockMode) {
    return mockNodeAvailability(node);
  }

  const result = await hostExec(
    settings,
    node,
    ["bash", "-lc", buildHostAptProbeScript()],
    180,
  );

  if (result.timedOut) {
    return {
      available: false,
      detail: "Host update check timed out",
      pendingCount: 0,
      checkedAt,
      method: "apt",
    };
  }

  if ((result.code ?? 1) !== 0 && !result.stdout.includes("RESULT|")) {
    return {
      available: false,
      detail: `Host check failed: ${(result.stderr || result.stdout || "unknown error").trim().slice(0, 200)}`,
      pendingCount: 0,
      checkedAt,
      method: "apt",
    };
  }

  const parsed = parseProbeOutput(result.stdout);
  return { ...parsed, checkedAt, method: "apt" };
}
