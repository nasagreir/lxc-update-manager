"use client";

import { useCallback, useEffect, useState } from "react";
import { Boxes, Clock3, ScrollText, Settings2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ContainersPanel } from "@/components/dashboard/containers-panel";
import { JobsPanel } from "@/components/dashboard/jobs-panel";
import { AutomationsPanel } from "@/components/dashboard/automations-panel";
import { SettingsPanel } from "@/components/dashboard/settings-panel";
import { JobLogDialog } from "@/components/dashboard/job-log-dialog";
import type { Automation, LxcContainer, UpdateJob } from "@/lib/types";

export function AppShell() {
  const [tab, setTab] = useState("containers");
  const [containers, setContainers] = useState<LxcContainer[]>([]);
  const [jobs, setJobs] = useState<UpdateJob[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mockMode, setMockMode] = useState(true);
  const [logJobId, setLogJobId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const loadContainers = useCallback(async (detect = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/containers${detect ? "?refresh=1" : ""}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load containers");
      setContainers(data.containers);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const checkUpdates = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/containers?check=1");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update check failed");
      setContainers(data.containers);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    if (res.ok) setJobs(data.jobs);
  }, []);

  const loadAutomations = useCallback(async () => {
    const res = await fetch("/api/automations");
    const data = await res.json();
    if (res.ok) setAutomations(data.automations);
  }, []);

  const loadSettingsFlag = useCallback(async () => {
    const res = await fetch("/api/settings");
    const data = await res.json();
    if (res.ok) setMockMode(Boolean(data.settings?.mockMode));
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      loadContainers(false),
      loadJobs(),
      loadAutomations(),
      loadSettingsFlag(),
    ]);
  }, [loadAutomations, loadContainers, loadJobs, loadSettingsFlag]);

  useEffect(() => {
    void refreshAll();
    // Initial load only — avoid depending on refreshAll identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasActiveJobs = jobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );

  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = setInterval(() => {
      void loadJobs();
      void loadContainers(false);
    }, 2000);
    return () => clearInterval(timer);
  }, [hasActiveJobs, loadContainers, loadJobs]);

  async function handleUpdate(vmids: number[]) {
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch("/api/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vmids, staggerSeconds: 5 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed to start");
      await loadJobs();
      setTab("jobs");
      if (data.jobs?.[0]?.id) {
        setLogJobId(data.jobs[0].id);
        setLogOpen(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(false);
    }
  }

  const runningCount = containers.filter((c) => c.status === "running").length;
  const availableCount = containers.filter((c) => c.updateAvailable).length;
  const activeJobs = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6">
      <header className="mb-8 animate-fade-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs tracking-[0.2em] text-teal-800/80 uppercase">
              Proxmox · LXC
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              LXC Updater
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-600 sm:text-base">
              Check every container on the node, run community helper-script{" "}
              <span className="font-mono text-[0.9em]">update</span> from the
              browser, and schedule unattended upgrades.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {mockMode && (
              <Badge
                variant="outline"
                className="border-amber-400/60 bg-amber-50 text-amber-900"
              >
                Mock mode
              </Badge>
            )}
            <Badge variant="secondary">
              {runningCount}/{containers.length} running
            </Badge>
            {availableCount > 0 && (
              <Badge className="bg-red-600 text-white hover:bg-red-600">
                {availableCount} update{availableCount === 1 ? "" : "s"} available
              </Badge>
            )}
            {activeJobs > 0 && (
              <Badge className="bg-teal-700 text-white hover:bg-teal-700">
                {activeJobs} job{activeJobs === 1 ? "" : "s"} active
              </Badge>
            )}
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col">
        <TabsList className="mb-6 h-auto w-full flex-wrap justify-start gap-1 bg-white/60 p-1 shadow-sm">
          <TabsTrigger value="containers" className="gap-1.5">
            <Boxes className="size-4" />
            Containers
          </TabsTrigger>
          <TabsTrigger value="jobs" className="gap-1.5">
            <ScrollText className="size-4" />
            Jobs
            {activeJobs > 0 && (
              <span className="ml-1 rounded-full bg-teal-700 px-1.5 text-[10px] text-white">
                {activeJobs}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="automations" className="gap-1.5">
            <Clock3 className="size-4" />
            Automations
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <Settings2 className="size-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="containers" className="flex-1">
          <ContainersPanel
            containers={containers}
            loading={loading}
            checking={checking}
            error={error}
            onRefresh={(detect) => void loadContainers(detect)}
            onCheckUpdates={() => void checkUpdates()}
            onUpdate={handleUpdate}
            updating={updating}
          />
        </TabsContent>
        <TabsContent value="jobs" className="flex-1">
          <JobsPanel
            jobs={jobs}
            onOpenLog={(id) => {
              setLogJobId(id);
              setLogOpen(true);
            }}
          />
        </TabsContent>
        <TabsContent value="automations" className="flex-1">
          <AutomationsPanel
            automations={automations}
            containers={containers}
            onChanged={async () => {
              await loadAutomations();
              await loadJobs();
            }}
          />
        </TabsContent>
        <TabsContent value="settings" className="flex-1">
          <SettingsPanel onSaved={refreshAll} />
        </TabsContent>
      </Tabs>

      <JobLogDialog
        jobId={logJobId}
        open={logOpen}
        onOpenChange={setLogOpen}
      />

      <footer className="mt-10 border-t border-border/60 pt-4 text-xs text-muted-foreground">
        Runs inside an LXC on your Proxmox node. Data persists under{" "}
        <code className="font-mono">data/</code>.
      </footer>
    </div>
  );
}
