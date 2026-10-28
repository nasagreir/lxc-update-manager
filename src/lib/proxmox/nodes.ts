import type { AppSettings } from "@/lib/types";

/** Parse includeNodes / legacy defaultNode into a list (empty = all nodes). */
export function parseIncludeNodes(settings: AppSettings): string[] {
  const raw = (settings.includeNodes || settings.defaultNode || "").trim();
  if (!raw) return [];
  return raw
    .split(/[\s,;]+/)
    .map((n) => n.trim())
    .filter(Boolean);
}

/**
 * Parse nodeSshHosts into a map.
 * Accepts lines or commas: `pve1=10.0.0.1` / `pve1:10.0.0.1`
 */
export function parseNodeSshHosts(settings: AppSettings): Record<string, string> {
  const raw = settings.nodeSshHosts || "";
  const map: Record<string, string> = {};
  for (const part of raw.split(/[\n,]+/)) {
    const line = part.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([^=:\s]+)\s*[=:]\s*(\S+)$/);
    if (m) {
      map[m[1]!] = m[2]!;
    }
  }
  return map;
}

/** Resolve which SSH host to use for pct exec on a given Proxmox node. */
export function resolveSshHostForNode(
  settings: AppSettings,
  node: string,
): string {
  const map = parseNodeSshHosts(settings);
  if (map[node]) return map[node];
  if (settings.sshHost?.trim()) return settings.sshHost.trim();
  // Last resort: use the Proxmox node name as the hostname (common in clusters with DNS).
  return node;
}
