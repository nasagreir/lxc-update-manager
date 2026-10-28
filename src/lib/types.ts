export type ContainerStatus = "running" | "stopped" | "unknown";

export type UpdateMethod = "community-script" | "apt" | "apk" | "unknown";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type TriggerSource = "manual" | "automation";

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

export interface UpdateJob {
  id: string;
  vmid: number;
  containerName: string;
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
  /** Stagger starts by this many seconds between containers. */
  staggerSeconds: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
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

export interface AppState {
  settings: AppSettings;
  automations: Automation[];
  jobs: UpdateJob[];
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
}
