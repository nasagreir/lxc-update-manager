"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Clock3,
  KeyRound,
  LogOut,
  ScrollText,
  Server,
  Settings2,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContainersPanel } from "@/components/dashboard/containers-panel";
import { NodesPanel } from "@/components/dashboard/nodes-panel";
import { JobsPanel } from "@/components/dashboard/jobs-panel";
import { AutomationsPanel } from "@/components/dashboard/automations-panel";
import { ApiKeysPanel } from "@/components/dashboard/api-keys-panel";
import { SettingsPanel } from "@/components/dashboard/settings-panel";
import { JobLogDialog } from "@/components/dashboard/job-log-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { useDuoLayout } from "@/hooks/use-duo-layout";
import { cn } from "@/lib/utils";
import type {
  Automation,
  LxcContainer,
  ProxmoxNode,
  UpdateJob,
} from "@/lib/types";

const NAV_ITEMS = [
  { value: "containers", label: "Containers", icon: Boxes },
  { value: "nodes", label: "Nodes", icon: Server },
  { value: "jobs", label: "Jobs", icon: ScrollText },
  { value: "automations", label: "Automations", icon: Clock3 },
  { value: "api-keys", label: "API keys", icon: KeyRound },
  { value: "settings", label: "Settings", icon: Settings2 },
] as const;

export function AppShell() {
  const router = useRouter();
  const { sideRail, compactWidth } = useDuoLayout();
  const [tab, setTab] = useState("containers");
  const [containers, setContainers] = useState<LxcContainer[]>([]);
  const [nodes, setNodes] = useState<ProxmoxNode[]>([]);
  const [jobs, setJobs] = useState<UpdateJob[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [nodesChecking, setNodesChecking] = useState(false);
  const [nodesUpdating, setNodesUpdating] = useState(false);
  const [nodesError, setNodesError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mockMode, setMockMode] = useState(true);
  const [logJobId, setLogJobId] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [rollingBackVmid, setRollingBackVmid] = useState<number | null>(null);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

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

  const loadNodes = useCallback(async () => {
    setNodesLoading(true);
    setNodesError(null);
    try {
      const res = await fetch("/api/nodes");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load nodes");
      setNodes(data.nodes);
    } catch (err) {
      setNodesError(err instanceof Error ? err.message : String(err));
    } finally {
      setNodesLoading(false);
    }
  }, []);

  const checkNodeUpdates = useCallback(async () => {
    setNodesChecking(true);
    setNodesError(null);
    try {
      const res = await fetch("/api/nodes?check=1");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Node update check failed");
      setNodes(data.nodes);
    } catch (err) {
      setNodesError(err instanceof Error ? err.message : String(err));
    } finally {
      setNodesChecking(false);
    }
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
      loadNodes(),
      loadJobs(),
      loadAutomations(),
      loadSettingsFlag(),
    ]);
  }, [loadAutomations, loadContainers, loadJobs, loadNodes, loadSettingsFlag]);

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
      void loadNodes();
    }, 2000);
    return () => clearInterval(timer);
  }, [hasActiveJobs, loadContainers, loadJobs, loadNodes]);

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

  async function handleRollback(vmid: number) {
    const container = containers.find((c) => c.vmid === vmid);
    const name = container?.name ?? `CT ${vmid}`;
    const snap = container?.lastSnapshotName ?? "the pre-update snapshot";
    const ok = window.confirm(
      `Roll ${name} back to Proxmox snapshot ${snap}? The guest restarts at the state from before its last update.`,
    );
    if (!ok) return;
    setRollingBackVmid(vmid);
    setError(null);
    try {
      const res = await fetch("/api/containers/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vmid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rollback failed");
      await Promise.all([loadContainers(false), loadJobs()]);
      if (data.jobId) {
        setLogJobId(data.jobId);
        setLogOpen(true);
        setTab("jobs");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRollingBackVmid(null);
    }
  }

  async function handleNodeUpdate(nodeNames: string[]) {
    setNodesUpdating(true);
    setNodesError(null);
    try {
      const res = await fetch("/api/nodes/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes: nodeNames, staggerSeconds: 30 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Host update failed to start");
      await Promise.all([loadJobs(), loadNodes()]);
      setTab("jobs");
      if (data.jobs?.[0]?.id) {
        setLogJobId(data.jobs[0].id);
        setLogOpen(true);
      }
    } catch (err) {
      setNodesError(err instanceof Error ? err.message : String(err));
    } finally {
      setNodesUpdating(false);
    }
  }

  const runningCount = containers.filter((c) => c.status === "running").length;
  const nodeCount = nodes.length || new Set(containers.map((c) => c.node)).size;
  const availableCount = containers.filter((c) => c.updateAvailable).length;
  const nodeUpdatesAvailable = nodes.filter((n) => n.updateAvailable).length;
  const activeJobs = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  ).length;

  const tabBadge = (value: string) => {
    if (value === "nodes" && nodeUpdatesAvailable > 0) {
      return (
        <span className="rounded-full bg-orange-600 px-1.5 text-[10px] text-white">
          {nodeUpdatesAvailable}
        </span>
      );
    }
    if (value === "jobs" && activeJobs > 0) {
      return (
        <span className="rounded-full bg-teal-700 px-1.5 text-[10px] text-white">
          {activeJobs}
        </span>
      );
    }
    if (value === "containers" && availableCount > 0) {
      return (
        <span className="rounded-full bg-red-600 px-1.5 text-[10px] text-white">
          {availableCount}
        </span>
      );
    }
    return null;
  };

  return (
    <div
      className={cn(
        "safe-pad mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col overflow-x-clip",
        sideRail ? "py-3 sm:px-4" : "px-4 py-6 sm:px-6 sm:py-8",
      )}
    >
      <header
        className={cn(
          "animate-fade-up min-w-0",
          sideRail ? "mb-3" : "mb-6",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 gap-3",
            sideRail
              ? "flex-row items-center justify-between"
              : "flex-col",
          )}
        >
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.2em] text-primary/80 uppercase sm:text-xs">
              Proxmox · LXC
            </p>
            <h1
              className={cn(
                "font-semibold tracking-tight text-foreground",
                sideRail
                  ? "truncate text-xl"
                  : "mt-1 text-3xl sm:text-4xl",
              )}
            >
              LXC Updater
            </h1>
            {!sideRail && !compactWidth && (
              <p className="mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
                Check LXCs across your cluster, run community helper-script{" "}
                <span className="font-mono text-[0.9em]">update</span> from the
                browser, and schedule unattended upgrades.
              </p>
            )}
          </div>
          <div
            className={cn(
              "flex min-w-0 items-center gap-1.5 sm:gap-2",
              sideRail ? "shrink-0" : "w-full",
            )}
          >
            <div className="shrink-0">
              <ThemeToggle />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="touch-target shrink-0"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
            >
              <LogOut className="size-3.5" />
              <span className={sideRail ? "sr-only sm:not-sr-only" : undefined}>
                Sign out
              </span>
            </Button>
            {(mockMode || !sideRail) && (
              <div className="chip-scroll flex-1">
                <div className="flex w-max items-center gap-1.5 pr-1">
                  {mockMode && (
                    <Badge
                      variant="outline"
                      className="border-amber-500/50 bg-amber-500/15 text-amber-900 dark:text-amber-200"
                    >
                      Mock
                    </Badge>
                  )}
                  {!sideRail && (
                    <>
                      <Badge variant="secondary">
                        {runningCount}/{containers.length} running
                      </Badge>
                      {nodeCount > 0 && (
                        <Badge variant="outline">
                          {nodeCount} node{nodeCount === 1 ? "" : "s"}
                        </Badge>
                      )}
                      {availableCount > 0 && (
                        <Badge className="bg-red-600 text-white hover:bg-red-600">
                          {availableCount} CT update
                          {availableCount === 1 ? "" : "s"}
                        </Badge>
                      )}
                      {nodeUpdatesAvailable > 0 && (
                        <Badge className="bg-orange-600 text-white hover:bg-orange-600">
                          {nodeUpdatesAvailable} host update
                          {nodeUpdatesAvailable === 1 ? "" : "s"}
                        </Badge>
                      )}
                      {activeJobs > 0 && (
                        <Badge className="bg-teal-700 text-white hover:bg-teal-700 dark:bg-teal-600">
                          {activeJobs} job{activeJobs === 1 ? "" : "s"} active
                        </Badge>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={setTab}
        orientation={sideRail ? "vertical" : "horizontal"}
        className={cn(
          "duo-fold-gutter flex flex-1",
          sideRail ? "flex-row gap-3" : "flex-col",
        )}
      >
        <TabsList
          className={cn(
            "bg-card/70 shadow-sm",
            sideRail
              ? "sticky top-[max(0.5rem,env(safe-area-inset-top))] order-2 h-auto w-14 shrink-0 flex-col justify-start gap-1 self-start p-1 sm:w-[4.5rem]"
              : "duo-tabstrip mb-4 gap-1 p-1",
          )}
        >
          {NAV_ITEMS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className={cn(
                "gap-1.5",
                sideRail
                  ? "touch-target h-auto w-full flex-col justify-center px-1 py-2 text-[10px] leading-tight whitespace-normal"
                  : "px-3 py-2",
              )}
              title={label}
            >
              <Icon className="size-4 shrink-0" />
              <span className={sideRail ? "max-w-full truncate" : undefined}>
                {sideRail
                  ? label === "API keys"
                    ? "API"
                    : label === "Automations"
                      ? "Auto"
                      : label === "Containers"
                        ? "CTs"
                        : label === "Settings"
                          ? "Set"
                          : label
                  : label}
              </span>
              {tabBadge(value)}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="min-w-0 flex-1">
          <TabsContent value="containers" className="flex-1 outline-none">
            <ContainersPanel
              containers={containers}
              loading={loading}
              checking={checking}
              error={error}
              onRefresh={(detect) => void loadContainers(detect)}
              onCheckUpdates={() => void checkUpdates()}
              onUpdate={handleUpdate}
              updating={updating}
              onRollback={(vmid) => void handleRollback(vmid)}
              rollingBackVmid={rollingBackVmid}
            />
          </TabsContent>
          <TabsContent value="nodes" className="flex-1 outline-none">
            <NodesPanel
              nodes={nodes}
              loading={nodesLoading}
              checking={nodesChecking}
              error={nodesError}
              onRefresh={() => void loadNodes()}
              onCheckUpdates={() => void checkNodeUpdates()}
              onUpdate={handleNodeUpdate}
              updating={nodesUpdating}
            />
          </TabsContent>
          <TabsContent value="jobs" className="flex-1 outline-none">
            <JobsPanel
              jobs={jobs}
              onOpenLog={(id) => {
                setLogJobId(id);
                setLogOpen(true);
              }}
            />
          </TabsContent>
          <TabsContent value="automations" className="flex-1 outline-none">
            <AutomationsPanel
              automations={automations}
              containers={containers}
              onChanged={async () => {
                await loadAutomations();
                await loadJobs();
              }}
            />
          </TabsContent>
          <TabsContent value="api-keys" className="flex-1 outline-none">
            <ApiKeysPanel />
          </TabsContent>
          <TabsContent value="settings" className="flex-1 outline-none">
            <SettingsPanel onSaved={refreshAll} />
          </TabsContent>
        </div>
      </Tabs>

      <JobLogDialog
        jobId={logJobId}
        open={logOpen}
        onOpenChange={setLogOpen}
      />

      {!sideRail && (
        <footer className="mt-10 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          Runs inside an LXC on your Proxmox cluster. Data persists under{" "}
          <code className="font-mono">data/</code>.
        </footer>
      )}
    </div>
  );
}
