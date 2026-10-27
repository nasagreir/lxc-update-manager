"use client";

import { useMemo, useState } from "react";
import {
  RefreshCw,
  ArrowUpCircle,
  Search,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import type { LxcContainer } from "@/lib/types";
import { formatRelative, methodLabel, statusTone } from "@/lib/format";

export function ContainersPanel({
  containers,
  loading,
  error,
  onRefresh,
  onUpdate,
  updating,
}: {
  containers: LxcContainer[];
  loading: boolean;
  error: string | null;
  onRefresh: (detect: boolean) => void;
  onUpdate: (vmids: number[]) => Promise<void>;
  updating: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return containers;
    return containers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        String(c.vmid).includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)) ||
        c.updateMethod.includes(q),
    );
  }, [containers, query]);

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

  const selectedList = [...selected];

  return (
    <div className="space-y-4 animate-fade-up">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, VMID, tag…"
            className="pl-9 bg-white/70"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRefresh(false)}
            disabled={loading}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRefresh(true)}
            disabled={loading}
            title="Probe each running CT for update / apt / apk"
          >
            Detect methods
          </Button>
          <Button
            size="sm"
            disabled={selectedList.length === 0 || updating}
            onClick={() => void onUpdate(selectedList)}
          >
            {updating ? <Loader2 className="animate-spin" /> : <ArrowUpCircle />}
            Update selected ({selectedList.length})
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
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
        <div className="overflow-x-auto rounded-lg border border-border/80 bg-white/75 shadow-sm backdrop-blur-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50/80 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-3 py-3">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-3 py-3 font-medium">CT</th>
                <th className="px-3 py-3 font-medium">Name</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Update</th>
                <th className="px-3 py-3 font-medium">Last update</th>
                <th className="px-3 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr
                  key={c.vmid}
                  className="border-b border-border/60 transition-colors hover:bg-teal-50/40"
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
                  </td>
                  <td className="px-3 py-3">
                    <Badge
                      variant="outline"
                      className={statusTone(c.status)}
                    >
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
                    {formatRelative(c.lastUpdatedAt)}
                    {c.lastUpdateStatus && (
                      <span className="ml-1 text-xs">
                        ({c.lastUpdateStatus})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        updating ||
                        c.status !== "running" ||
                        c.updateMethod === "unknown"
                      }
                      onClick={() => void onUpdate([c.vmid])}
                    >
                      Update
                    </Button>
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
