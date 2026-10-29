"use client";

import { useMemo, useState } from "react";
import {
  RefreshCw,
  ArrowUpCircle,
  Search,
  Loader2,
  Radar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LxcContainer } from "@/lib/types";
import { formatRelative, methodLabel, statusTone } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ContainersPanel({
  containers,
  loading,
  checking,
  error,
  onRefresh,
  onCheckUpdates,
  onUpdate,
  updating,
}: {
  containers: LxcContainer[];
  loading: boolean;
  checking: boolean;
  error: string | null;
  onRefresh: (detect: boolean) => void;
  onCheckUpdates: () => void;
  onUpdate: (vmids: number[]) => Promise<void>;
  updating: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [nodeFilter, setNodeFilter] = useState<string>("all");

  const nodes = useMemo(() => {
    return [...new Set(containers.map((c) => c.node))].sort();
  }, [containers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return containers.filter((c) => {
      if (nodeFilter !== "all" && c.node !== nodeFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        String(c.vmid).includes(q) ||
        c.node.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)) ||
        c.updateMethod.includes(q)
      );
    });
  }, [containers, query, nodeFilter]);

  const availableCount = containers.filter((c) => c.updateAvailable).length;
  const selectedAvailable = filtered.filter(
    (c) => selected.has(c.vmid) && c.updateAvailable,
  );

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((c) => selected.has(c.vmid));

  function toggleAll() {
    if (allFilteredSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((c) => c.vmid)));
    }
  }

  function toggleOne(vmid: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(vmid)) next.delete(vmid);
      else next.add(vmid);
      return next;
    });
  }

  return (
    <div className="space-y-4 animate-fade-up">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, VMID, node, tag…"
              className="pl-9 bg-card/70"
            />
          </div>
          <Select value={nodeFilter} onValueChange={setNodeFilter}>
            <SelectTrigger className="w-full bg-card/70 sm:w-44">
              <SelectValue placeholder="All nodes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All nodes</SelectItem>
              {nodes.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRefresh(false)}
            disabled={loading || checking}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRefresh(true)}
            disabled={loading || checking}
            title="Probe each running CT for update / apt / apk"
          >
            Detect methods
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onCheckUpdates}
            disabled={loading || checking}
            title="Refresh package indexes and detect pending updates"
          >
            {checking ? <Loader2 className="animate-spin" /> : <Radar />}
            Check for updates
            {availableCount > 0 && !checking && (
              <span className="ml-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">
                {availableCount}
              </span>
            )}
          </Button>
          <Button
            size="sm"
            disabled={selectedAvailable.length === 0 || updating}
            onClick={() =>
              void onUpdate(selectedAvailable.map((c) => c.vmid))
            }
            title="Updates only the selected containers that have updates available"
          >
            {updating ? <Loader2 className="animate-spin" /> : <ArrowUpCircle />}
            Update selected ({selectedAvailable.length})
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/15 px-3 py-2 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {loading && containers.length === 0 ? (
        <div className="flex items-center gap-2 py-16 justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          Loading containers…
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          No containers match. Configure Proxmox in Settings, or keep mock mode
          on to explore the UI.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/80 bg-card/80 shadow-sm backdrop-blur-sm">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-3 py-3">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-3 py-3 font-medium">CT</th>
                <th className="px-3 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Node</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Method</th>
                <th className="px-3 py-3 font-medium">Last checked</th>
                <th className="px-3 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr
                  key={`${c.node}-${c.vmid}`}
                  className={cn(
                    "border-b border-border/60 transition-colors hover:bg-accent/40",
                    c.updateAvailable && "bg-red-500/10",
                  )}
                  style={{ animationDelay: `${i * 30}ms` }}
                >
                  <td className="px-3 py-3">
                    <Checkbox
                      checked={selected.has(c.vmid)}
                      onCheckedChange={() => toggleOne(c.vmid)}
                      aria-label={`Select ${c.name}`}
                    />
                  </td>
                  <td className="px-3 py-3 font-mono text-muted-foreground">
                    {c.vmid}
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium">{c.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <Badge
                          key={t}
                          variant="secondary"
                          className="text-[10px] font-normal"
                        >
                          {t}
                        </Badge>
                      ))}
                    </div>
                    {c.updateAvailableDetail && c.updateAvailable && (
                      <p className="mt-1 text-xs text-red-700/90">
                        {c.updateAvailableDetail}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.node}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant="outline" className={statusTone(c.status)}>
                      {c.status === "running" && (
                        <span className="mr-1 inline-block size-1.5 rounded-full bg-emerald-500 animate-pulse-soft" />
                      )}
                      {c.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-mono text-xs">
                      {methodLabel(c.updateMethod)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatRelative(c.lastCheckedAt)}
                    {c.lastUpdatedAt && (
                      <div className="text-xs">
                        updated {formatRelative(c.lastUpdatedAt)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {c.updateAvailable ? (
                      <Button
                        size="sm"
                        disabled={
                          updating ||
                          c.status !== "running" ||
                          c.updateMethod === "unknown"
                        }
                        onClick={() => void onUpdate([c.vmid])}
                        title={c.updateAvailableDetail ?? "Updates available"}
                        className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600/40"
                      >
                        Update available
                      </Button>
                    ) : c.updateAvailable === false ? (
                      <span
                        className="text-xs font-medium text-emerald-700 dark:text-emerald-400"
                        title={c.updateAvailableDetail ?? "Up to date"}
                      >
                        Up to date
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Not checked
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
