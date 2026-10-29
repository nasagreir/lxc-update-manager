import type { JobStatus, UpdateMethod } from "@/lib/types";

export function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function methodLabel(method: UpdateMethod): string {
  switch (method) {
    case "community-script":
      return "Helper script";
    case "apt":
      return "apt";
    case "apk":
      return "apk";
    default:
      return "Unknown";
  }
}

export function statusTone(
  status: JobStatus | "running" | "stopped" | "unknown" | "online" | "offline",
): string {
  switch (status) {
    case "running":
    case "succeeded":
    case "online":
      return "bg-emerald-500/15 text-emerald-800 border-emerald-500/30 dark:text-emerald-300";
    case "queued":
      return "bg-sky-500/15 text-sky-800 border-sky-500/30 dark:text-sky-300";
    case "failed":
    case "offline":
      return "bg-red-500/15 text-red-800 border-red-500/30 dark:text-red-300";
    case "stopped":
    case "cancelled":
      return "bg-slate-500/10 text-slate-600 border-slate-400/30 dark:text-slate-300";
    default:
      return "bg-amber-500/15 text-amber-900 border-amber-500/30 dark:text-amber-200";
  }
}
