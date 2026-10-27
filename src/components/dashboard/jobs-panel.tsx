"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { UpdateJob } from "@/lib/types";
import { formatRelative, methodLabel, statusTone } from "@/lib/format";
import { ScrollText } from "lucide-react";

export function JobsPanel({
  jobs,
  onOpenLog,
}: {
  jobs: UpdateJob[];
  onOpenLog: (jobId: string) => void;
}) {
  if (jobs.length === 0) {
    return (
      <div className="animate-fade-up py-16 text-center text-muted-foreground">
        No update jobs yet. Select containers and run an update to see logs here.
      </div>
    );
  }

  return (
    <div className="animate-fade-up overflow-x-auto rounded-lg border border-border/80 bg-white/75 shadow-sm backdrop-blur-sm">
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr className="border-b bg-slate-50/80 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-3 font-medium">When</th>
            <th className="px-3 py-3 font-medium">Container</th>
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
              className="border-b border-border/60 hover:bg-teal-50/40"
            >
              <td className="px-3 py-3 text-muted-foreground">
                {formatRelative(job.startedAt ?? job.finishedAt)}
              </td>
              <td className="px-3 py-3">
                <span className="font-mono text-xs text-muted-foreground">
                  {job.vmid}
                </span>{" "}
                <span className="font-medium">{job.containerName}</span>
              </td>
              <td className="px-3 py-3 font-mono text-xs">
                {methodLabel(job.updateMethod)}
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
