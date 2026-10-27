import type { AppSettings, ContainerStatus, LxcContainer } from "@/lib/types";
import { MOCK_CONTAINERS } from "@/lib/store/defaults";

interface PveLxcEntry {
  vmid: number;
  name?: string;
  status?: string;
  cpus?: number;
  maxmem?: number;
  tags?: string;
}

interface PveNode {
  node: string;
  status?: string;
}

function authHeader(settings: AppSettings): string {
  return `PVEAPIToken=${settings.apiTokenId}=${settings.apiTokenSecret}`;
}

function baseUrl(settings: AppSettings): string {
  const host = settings.proxmoxHost.replace(/\/$/, "");
  if (host.startsWith("http://") || host.startsWith("https://")) {
    return `${host}/api2/json`;
  }
  return `https://${host}:${settings.proxmoxPort}/api2/json`;
}

async function pveFetch<T>(
  settings: AppSettings,
  pathname: string,
): Promise<T> {
  if (!settings.apiTokenSecret) {
    throw new Error("Proxmox API token secret is not configured.");
  }

  const url = `${baseUrl(settings)}${pathname}`;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(settings),
    },
    // Node fetch: allow self-signed when verify is off
    // @ts-expect-error undici option
    tls: settings.proxmoxVerifyTls
      ? undefined
      : { rejectUnauthorized: false },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Proxmox API ${res.status} on ${pathname}: ${body || res.statusText}`,
    );
  }

  const json = (await res.json()) as { data: T };
  return json.data;
}

/**
 * Node's built-in fetch does not expose rejectUnauthorized easily in all
 * runtimes. Prefer an HTTPS agent when TLS verification is disabled.
 */
async function pveFetchSafe<T>(
  settings: AppSettings,
  pathname: string,
): Promise<T> {
  if (settings.proxmoxVerifyTls) {
    return pveFetch<T>(settings, pathname);
  }

  const https = await import("https");
  const url = `${baseUrl(settings)}${pathname}`;
  const agent = new https.Agent({ rejectUnauthorized: false });

  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: { Authorization: authHeader(settings) },
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(
              new Error(
                `Proxmox API ${res.statusCode} on ${pathname}: ${text}`,
              ),
            );
            return;
          }
          try {
            const parsed = JSON.parse(text) as { data: T };
            resolve(parsed.data);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function mapStatus(status?: string): ContainerStatus {
  if (status === "running") return "running";
  if (status === "stopped") return "stopped";
  return "unknown";
}

export async function listNodes(settings: AppSettings): Promise<string[]> {
  const nodes = await pveFetchSafe<PveNode[]>(settings, "/nodes");
  return nodes.map((n) => n.node);
}

export async function listLxcFromProxmox(
  settings: AppSettings,
): Promise<Omit<LxcContainer, "updateMethod" | "lastCheckedAt" | "lastUpdatedAt" | "lastUpdateStatus" | "notes">[]> {
  const nodeNames = settings.defaultNode
    ? [settings.defaultNode]
    : await listNodes(settings);

  const all: Omit<
    LxcContainer,
    | "updateMethod"
    | "lastCheckedAt"
    | "lastUpdatedAt"
    | "lastUpdateStatus"
    | "notes"
  >[] = [];

  for (const node of nodeNames) {
    const entries = await pveFetchSafe<PveLxcEntry[]>(
      settings,
      `/nodes/${encodeURIComponent(node)}/lxc`,
    );
    for (const entry of entries) {
      all.push({
        vmid: entry.vmid,
        name: entry.name || `ct-${entry.vmid}`,
        status: mapStatus(entry.status),
        node,
        cpus: entry.cpus ?? 0,
        memoryMb: Math.round((entry.maxmem ?? 0) / (1024 * 1024)),
        tags: entry.tags
          ? entry.tags.split(/[;,]/).map((t) => t.trim()).filter(Boolean)
          : [],
      });
    }
  }

  return all.sort((a, b) => a.vmid - b.vmid);
}

export async function listContainers(
  settings: AppSettings,
): Promise<
  Omit<
    LxcContainer,
    | "updateMethod"
    | "lastCheckedAt"
    | "lastUpdatedAt"
    | "lastUpdateStatus"
    | "notes"
  >[]
> {
  if (settings.mockMode) {
    return MOCK_CONTAINERS.map(
      ({
        vmid,
        name,
        status,
        node,
        cpus,
        memoryMb,
        tags,
      }) => ({ vmid, name, status, node, cpus, memoryMb, tags }),
    );
  }
  return listLxcFromProxmox(settings);
}
