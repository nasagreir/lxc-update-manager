"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { UpdateJob } from "@/lib/types";
import { statusTone } from "@/lib/format";

export function JobLogDialog({
  jobId,
  open,
  onOpenChange,
}: {
  jobId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [job, setJob] = useState<UpdateJob | null>(null);

  useEffect(() => {
    if (!open || !jobId) return;
    let cancelled = false;

    async function load() {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) return;
      const data = (await res.json()) as { job: UpdateJob };
      if (!cancelled) setJob(data.job);
    }

    void load();
    const timer = setInterval(() => void load(), 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, jobId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">
              CT {job?.vmid}
            </span>
            <span>{job?.containerName ?? "Update log"}</span>
            {job && (
              <Badge variant="outline" className={statusTone(job.status)}>
                {job.status}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[420px] rounded-md border bg-slate-950/95 p-3">
          <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-emerald-100/90">
            {job?.log || "Waiting for output…"}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
