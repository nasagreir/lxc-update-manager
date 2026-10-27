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
  /** Node name; leave blank to query all nodes. */
  defaultNode: string;
  /**
   * How to run commands inside LXCs.
   * - ssh: SSH to the Proxmox host and run `pct exec`
   * - local: run `pct` on this host (privileged LXC with host tools)
   */
  execMode: "ssh" | "local";
  sshHost: string;
  sshPort: number;
  sshUser: string;
  /** Absolute path to private key inside this app container. */
  sshPrivateKeyPath: string;
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
  /** Cached container enrichments (update method, last update). */
  containerMeta: Record<
    string,
    {
      updateMethod: UpdateMethod;
      lastCheckedAt: string | null;
      lastUpdatedAt: string | null;
      lastUpdateStatus: JobStatus | null;
      notes?: string;
    }
  >;
}
