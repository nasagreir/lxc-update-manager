export type ContainerStatus = "running" | "stopped" | "unknown";

export type UpdateMethod = "community-script" | "apt" | "apk" | "unknown";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type TriggerSource = "manual" | "automation" | "api";

/** What a job updates — LXC guest or Proxmox host OS. */
export type JobTarget = "container" | "node";

export type NodeOnlineStatus = "online" | "offline" | "unknown";

export interface LxcContainer {
  vmid: number;
  name: string;
  status: ContainerStatus;
  node: string;
  cpus: number;
  memoryMb: number;
  tags: string[];
  updateMethod: UpdateMethod;
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
  lastUpdateStatus: JobStatus | null;
  /** null = not checked yet */
  updateAvailable: boolean | null;
  updateAvailableDetail: string | null;
  pendingUpdateCount: number;
  notes?: string;
}

/** Proxmox host (node) with apt system-update status. */
export interface ProxmoxNode {
  /** Cluster node name (e.g. pve1). */
  name: string;
  status: NodeOnlineStatus;
  /** Resolved SSH target used for host apt commands. */
  sshHost: string;
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
  lastUpdateStatus: JobStatus | null;
  /** null = not checked yet */
  updateAvailable: boolean | null;
  updateAvailableDetail: string | null;
  pendingUpdateCount: number;
}

export interface UpdateJob {
  id: string;
  /** Defaults to container for older persisted jobs. */
  target: JobTarget;
  /** Container VMID; 0 for node jobs. */
  vmid: number;
  /** Container name, or node display name for host jobs. */
  containerName: string;
  /** Proxmox node name — set for node jobs and optionally for CT jobs. */
  node?: string;
  status: JobStatus;
  trigger: TriggerSource;
  automationId?: string;
  updateMethod: UpdateMethod;
  startedAt: string | null;
  finishedAt: string | null;
  log: string;
  error?: string;
}

export type SchedulePreset =
  | "daily"
  | "weekly"
  | "monthly"
  | "custom";

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  /** Cron expression (5-field). */
  cron: string;
  schedulePreset: SchedulePreset;
  /** Empty = all running containers with a known update method. */
  containerIds: number[];
  /** Skip containers that are stopped. */
  onlyRunning: boolean;
  /** Re-check for updates before selecting targets. */
  checkBeforeRun: boolean;
  /** Only enqueue CTs that currently have updateAvailable === true. */
  onlyWhenUpdatesAvailable: boolean;
  /** Stagger starts by this many seconds between containers. */
  staggerSeconds: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

/** Stored API key metadata — raw secret is never persisted. */
export interface ApiKeyRecord {
  id: string;
  name: string;
  /** First characters of the key for identification (e.g. lxcu_abcd…). */
  prefix: string;
  /** SHA-256 hex of the full key. */
  keyHash: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AppSettings {
  /** When true, use sample containers and simulated updates (no Proxmox). */
  mockMode: boolean;
  proxmoxHost: string;
  proxmoxPort: number;
  /** Reject self-signed TLS when false. */
  proxmoxVerifyTls: boolean;
  /** Token auth: USER@REALM!TOKENID */
  apiTokenId: string;
  /** Token secret — stored in data/settings.json on disk. */
  apiTokenSecret: string;
  /**
   * Legacy single-node filter. Migrated into includeNodes when loading older state.
   * @deprecated use includeNodes
   */
  defaultNode: string;
  /**
   * Comma/whitespace-separated Proxmox node names to include.
   * Empty = all cluster nodes.
   */
  includeNodes: string;
  /**
   * How to run commands inside LXCs.
   * - ssh: SSH to each CT's node and run `pct exec`
   * - local: run `pct` on this host (only CTs on the same node)
   */
  execMode: "ssh" | "local";
  /** Fallback SSH host when a node has no entry in nodeSshHosts. */
  sshHost: string;
  sshPort: number;
  sshUser: string;
  /** Absolute path to private key inside this app container. */
  sshPrivateKeyPath: string;
  /**
   * Per-node SSH targets (required for multi-node: pct must run on the CT's node).
   * One `nodename=host` per line. Example:
   *   pve1=192.168.1.10
   *   pve2=192.168.1.11
   */
  nodeSshHosts: string;
  /** Seconds before an in-container update is killed. */
  updateTimeoutSeconds: number;
  /**
   * Answers fed to interactive community-script `update` prompts.
   * Newline-separated; typically "y" repeated.
   */
  communityScriptAnswers: string;
}

/** UI login password — raw secret is never persisted. */
export interface AuthState {
  /** scrypt hex digest of the password. */
  passwordHash: string | null;
  /** Hex salt used with scrypt. */
  passwordSalt: string | null;
  /** HMAC key for session cookies; rotated on password change/reset. */
  sessionSecret: string | null;
  passwordSetAt: string | null;
}

export interface AppState {
  settings: AppSettings;
  auth: AuthState;
  automations: Automation[];
  jobs: UpdateJob[];
  apiKeys: ApiKeyRecord[];
  /** Cached container enrichments (update method, last update, availability). */
  containerMeta: Record<
    string,
    {
      updateMethod: UpdateMethod;
      lastCheckedAt: string | null;
      lastUpdatedAt: string | null;
      lastUpdateStatus: JobStatus | null;
      updateAvailable: boolean | null;
      updateAvailableDetail: string | null;
      pendingUpdateCount: number;
      notes?: string;
    }
  >;
  /** Cached Proxmox host (node) system-update status, keyed by node name. */
  nodeMeta: Record<
    string,
    {
      lastCheckedAt: string | null;
      lastUpdatedAt: string | null;
      lastUpdateStatus: JobStatus | null;
      updateAvailable: boolean | null;
      updateAvailableDetail: string | null;
      pendingUpdateCount: number;
    }
  >;
}
