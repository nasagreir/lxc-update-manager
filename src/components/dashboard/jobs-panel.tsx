"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { UpdateJob } from "@/lib/types";
import { formatRelative, methodLabel, statusTone } from "@/lib/format";
import { useDuoLayout } from "@/hooks/use-duo-layout";
import { ScrollText } from "lucide-react";

export function JobsPanel({
  jobs,
  onOpenLog,
}: {
  jobs: UpdateJob[];
  onOpenLog: (jobId: string) => void;
}) {
  const { compactWidth } = useDuoLayout();

  if (jobs.length === 0) {
    return (
      <div className="animate-fade-up py-16 text-center text-muted-foreground">
        No update jobs yet. Update a container or Proxmox host to see logs here.
      </div>
    );
  }

  if (compactWidth) {
    return (
      <div className="animate-fade-up space-y-2">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="rounded-lg border border-border/80 bg-card/80 p-3 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {job.target === "node" ? (
                    <>
                      <Badge
                        variant="outline"
                        className="border-primary/30 bg-primary/15 text-primary"
                      >
                        Host
                      </Badge>
                      <span className="font-medium">
                        {job.node ?? job.containerName}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-xs text-muted-foreground">
                        {job.vmid}
                      </span>
                      <span className="font-medium">{job.containerName}</span>
                    </>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatRelative(job.startedAt ?? job.finishedAt)} ·{" "}
                  {job.target === "node"
                    ? "host apt"
                    : methodLabel(job.updateMethod)}{" "}
                  · {job.trigger}
                </p>
              </div>
              <Badge variant="outline" className={statusTone(job.status)}>
                {job.status}
              </Badge>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="mt-3 w-full touch-target"
              onClick={() => onOpenLog(job.id)}
            >
              <ScrollText />
              View log
            </Button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="animate-fade-up overflow-x-auto rounded-lg border border-border/80 bg-card/80 shadow-sm backdrop-blur-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-3 font-medium">When</th>
            <th className="px-3 py-3 font-medium">Target</th>
            <th className="px-3 py-3 font-medium">Method</th>
            <th className="px-3 py-3 font-medium">Trigger</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-3 py-3 font-medium text-right">Log</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr
              key={job.id}
              className="border-b border-border/60 hover:bg-accent/40"
            >
              <td className="px-3 py-3 text-muted-foreground">
                {formatRelative(job.startedAt ?? job.finishedAt)}
              </td>
              <td className="px-3 py-3">
                {job.target === "node" ? (
                  <>
                    <Badge
                      variant="outline"
                      className="mr-1.5 border-primary/30 bg-primary/15 text-primary"
                    >
                      Host
                    </Badge>
                    <span className="font-medium">
                      {job.node ?? job.containerName}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-xs text-muted-foreground">
                      {job.vmid}
                    </span>{" "}
                    <span className="font-medium">{job.containerName}</span>
                    {job.node && (
                      <span className="ml-1 font-mono text-xs text-muted-foreground">
                        @{job.node}
                      </span>
                    )}
                  </>
                )}
              </td>
              <td className="px-3 py-3 font-mono text-xs">
                {job.target === "node"
                  ? "host apt"
                  : methodLabel(job.updateMethod)}
              </td>
              <td className="px-3 py-3 capitalize text-muted-foreground">
                {job.trigger}
              </td>
              <td className="px-3 py-3">
                <Badge variant="outline" className={statusTone(job.status)}>
                  {job.status}
                </Badge>
              </td>
              <td className="px-3 py-3 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onOpenLog(job.id)}
                >
                  <ScrollText />
                  View
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
