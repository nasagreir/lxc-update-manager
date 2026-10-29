"use client";

import { useMemo, useState } from "react";
import {
  ArrowUpCircle,
  Loader2,
  Radar,
  RefreshCw,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import type { ProxmoxNode } from "@/lib/types";
import { formatRelative, statusTone } from "@/lib/format";
import { cn } from "@/lib/utils";

export function NodesPanel({
  nodes,
  loading,
  checking,
  error,
  onRefresh,
  onCheckUpdates,
  onUpdate,
  updating,
}: {
  nodes: ProxmoxNode[];
  loading: boolean;
  checking: boolean;
  error: string | null;
  onRefresh: () => void;
  onCheckUpdates: () => void;
  onUpdate: (nodeNames: string[]) => Promise<void>;
  updating: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const availableCount = nodes.filter((n) => n.updateAvailable).length;
  const selectedAvailable = nodes.filter(
    (n) => selected.has(n.name) && n.updateAvailable,
  );

  const allSelected =
    nodes.length > 0 && nodes.every((n) => selected.has(n.name));

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(nodes.map((n) => n.name)));
  }

  function toggleOne(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const sorted = useMemo(
    () => [...nodes].sort((a, b) => a.name.localeCompare(b.name)),
    [nodes],
  );

  return (
    <div className="space-y-4 animate-fade-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">
          System packages on each Proxmox host (apt), separate from LXC guests.
          Each row is one cluster node — check and update them individually.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRefresh()}
            disabled={loading || checking}
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onCheckUpdates()}
            disabled={loading || checking || nodes.length === 0}
          >
            {checking ? <Loader2 className="animate-spin" /> : <Radar />}
            Check for updates
            {availableCount > 0 && (
              <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">
                {availableCount}
              </span>
            )}
          </Button>
          <Button
            size="sm"
            className="bg-red-600 text-white hover:bg-red-700"
            disabled={updating || selectedAvailable.length === 0}
            onClick={() =>
              void onUpdate(selectedAvailable.map((n) => n.name))
            }
          >
            {updating ? (
              <Loader2 className="animate-spin" />
            ) : (
              <ArrowUpCircle />
            )}
            Update selected ({selectedAvailable.length})
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && nodes.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="animate-spin" />
          Loading nodes…
        </div>
      ) : nodes.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          No Proxmox nodes found. Check Settings → include nodes / API token.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/80 bg-white/75 shadow-sm backdrop-blur-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50/80 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-3 py-3">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={() => toggleAll()}
                    aria-label="Select all nodes"
                  />
                </th>
                <th className="px-3 py-3 font-medium">Node</th>
                <th className="px-3 py-3 font-medium">SSH host</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Last checked</th>
                <th className="px-3 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((node) => (
                <tr
                  key={node.name}
                  className="border-b border-border/60 hover:bg-teal-50/40"
                >
                  <td className="px-3 py-3">
                    <Checkbox
                      checked={selected.has(node.name)}
                      onCheckedChange={() => toggleOne(node.name)}
                      aria-label={`Select ${node.name}`}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <Server className="size-4 text-teal-800" />
                      <span className="font-semibold tracking-tight">
                        {node.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                    {node.sshHost}
                  </td>
                  <td className="px-3 py-3">
                    <Badge
                      variant="outline"
                      className={statusTone(node.status)}
                    >
                      {node.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatRelative(node.lastCheckedAt)}
                    {node.updateAvailableDetail &&
                      node.updateAvailable !== null && (
                        <div className="mt-0.5 max-w-xs text-xs text-slate-500">
                          {node.updateAvailableDetail}
                        </div>
                      )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {node.updateAvailable === true ? (
                      <Button
                        size="sm"
                        className={cn(
                          "bg-red-600 text-white hover:bg-red-700",
                        )}
                        disabled={updating}
                        onClick={() => void onUpdate([node.name])}
                      >
                        {updating ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <ArrowUpCircle />
                        )}
                        Update available
                        {node.pendingUpdateCount > 0 && (
                          <span className="ml-1 opacity-90">
                            ({node.pendingUpdateCount})
                          </span>
                        )}
                      </Button>
                    ) : node.updateAvailable === false ? (
                      <span className="text-sm font-medium text-emerald-700">
                        Up to date
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
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
