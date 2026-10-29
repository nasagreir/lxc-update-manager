"use client";

import { useState } from "react";
import { Plus, Play, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { Automation, LxcContainer, SchedulePreset } from "@/lib/types";
import { describeCron } from "@/lib/scheduler-client";
import { formatRelative } from "@/lib/format";

export function AutomationsPanel({
  automations,
  containers,
  onChanged,
}: {
  automations: Automation[];
  containers: LxcContainer[];
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("Nightly helper-script updates");
  const [preset, setPreset] = useState<SchedulePreset>("daily");
  const [cron, setCron] = useState("0 3 * * *");
  const [onlyRunning, setOnlyRunning] = useState(true);
  const [checkBeforeRun, setCheckBeforeRun] = useState(true);
  const [onlyWhenUpdatesAvailable, setOnlyWhenUpdatesAvailable] =
    useState(true);
  const [stagger, setStagger] = useState(30);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setName("Nightly helper-script updates");
    setPreset("daily");
    setCron("0 3 * * *");
    setOnlyRunning(true);
    setCheckBeforeRun(true);
    setOnlyWhenUpdatesAvailable(true);
    setStagger(30);
    setSelected([]);
    setError(null);
  }

  async function createAutomation() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          enabled: true,
          schedulePreset: preset,
          cron: preset === "custom" ? cron : undefined,
          containerIds: selected,
          onlyRunning,
          checkBeforeRun,
          onlyWhenUpdatesAvailable,
          staggerSeconds: stagger,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create");
      setOpen(false);
      resetForm();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    await fetch(`/api/automations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    await onChanged();
  }

  async function runNow(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/automations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runNow: true }),
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/automations/${id}`, { method: "DELETE" });
    await onChanged();
  }

  function toggleCt(vmid: number) {
    setSelected((prev) =>
      prev.includes(vmid) ? prev.filter((x) => x !== vmid) : [...prev, vmid],
    );
  }

  return (
    <div className="space-y-4 animate-fade-up">
      <div className="flex items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Cron-driven updates across the cluster. Prefer “only when updates
          available” so schedules re-check and skip CTs that are already current.
        </p>
        <Button
          size="sm"
          onClick={() => {
            resetForm();
            setOpen(true);
          }}
        >
          <Plus />
          New automation
        </Button>
      </div>

      {automations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 py-14 text-center text-muted-foreground">
          No automations yet. Create one to auto-update on a schedule.
        </div>
      ) : (
        <ul className="space-y-3">
          {automations.map((a) => (
            <li
              key={a.id}
              className="flex flex-col gap-3 rounded-lg border border-border/80 bg-card/80 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{a.name}</h3>
                  <Badge variant={a.enabled ? "default" : "secondary"}>
                    {a.enabled ? "Enabled" : "Paused"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {describeCron(a.cron)}
                  {" · "}
                  {a.containerIds.length === 0
                    ? "All updatable CTs"
                    : `${a.containerIds.length} selected CT(s)`}
                  {" · "}
                  stagger {a.staggerSeconds}s
                  {a.onlyWhenUpdatesAvailable ? " · only if outdated" : ""}
                  {a.checkBeforeRun ? " · check first" : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Last run: {formatRelative(a.lastRunAt)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="mr-2 flex items-center gap-2">
                  <Switch
                    checked={a.enabled}
                    onCheckedChange={(v) => void toggleEnabled(a.id, v)}
                  />
                  <span className="text-xs text-muted-foreground">Enabled</span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void runNow(a.id)}
                >
                  <Play />
                  Run now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void remove(a.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New automation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="auto-name">Name</Label>
              <Input
                id="auto-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Schedule</Label>
              <Select
                value={preset}
                onValueChange={(v) => setPreset(v as SchedulePreset)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily at 03:00</SelectItem>
                  <SelectItem value="weekly">Weekly (Sunday 03:00)</SelectItem>
                  <SelectItem value="monthly">Monthly (1st, 03:00)</SelectItem>
                  <SelectItem value="custom">Custom cron</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {preset === "custom" && (
              <div className="space-y-2">
                <Label htmlFor="cron">Cron expression</Label>
                <Input
                  id="cron"
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  className="font-mono"
                  placeholder="0 3 * * *"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="stagger">Stagger between CTs (seconds)</Label>
              <Input
                id="stagger"
                type="number"
                min={0}
                value={stagger}
                onChange={(e) => setStagger(Number(e.target.value))}
              />
            </div>
            <div className="space-y-3 rounded-md border bg-muted/50 p-3">
              <div className="flex items-center gap-2">
                <Switch
                  checked={onlyRunning}
                  onCheckedChange={setOnlyRunning}
                  id="only-running"
                />
                <Label htmlFor="only-running">Only running containers</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={checkBeforeRun}
                  onCheckedChange={setCheckBeforeRun}
                  id="check-first"
                />
                <Label htmlFor="check-first">
                  Check for updates before running
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={onlyWhenUpdatesAvailable}
                  onCheckedChange={setOnlyWhenUpdatesAvailable}
                  id="only-available"
                />
                <Label htmlFor="only-available">
                  Only update CTs with updates available
                </Label>
              </div>
            </div>
            <div className="space-y-2">
              <Label>
                Containers{" "}
                <span className="font-normal text-muted-foreground">
                  (none selected = all with a known updater)
                </span>
              </Label>
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-2">
                {containers.map((c) => (
                  <label
                    key={`${c.node}-${c.vmid}`}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={selected.includes(c.vmid)}
                      onCheckedChange={() => toggleCt(c.vmid)}
                    />
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.vmid}
                    </span>
                    {c.name}
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {c.node}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            {error && (
              <p className="text-sm text-red-700">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !name.trim()} onClick={() => void createAutomation()}>
              {busy && <Loader2 className="animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
