import { schedule, validate, type ScheduledTask } from "node-cron";
import { readState, updateState } from "@/lib/store/db";
import {
  checkUpdatesForContainers,
  enqueueUpdates,
  getContainers,
} from "@/lib/updater";
import type { Automation, SchedulePreset } from "@/lib/types";

const tasks = new Map<string, ScheduledTask>();
let started = false;

export function presetToCron(preset: SchedulePreset, customCron?: string): string {
  switch (preset) {
    case "daily":
      return "0 3 * * *";
    case "weekly":
      return "0 3 * * 0";
    case "monthly":
      return "0 3 1 * *";
    case "custom":
      return customCron || "0 3 * * *";
  }
}

export function describeCron(cronExpr: string): string {
  const map: Record<string, string> = {
    "0 3 * * *": "Every day at 03:00",
    "0 3 * * 0": "Every Sunday at 03:00",
    "0 3 1 * *": "1st of each month at 03:00",
  };
  return map[cronExpr] ?? cronExpr;
}

async function runAutomation(automationId: string) {
  const state = await readState();
  const automation = state.automations.find((a) => a.id === automationId);
  if (!automation || !automation.enabled) return;

  let containers = await getContainers();

  if (automation.checkBeforeRun) {
    containers = await checkUpdatesForContainers(containers);
  }

  let targets = containers.filter((c) => {
    if (automation.containerIds.length > 0) {
      return automation.containerIds.includes(c.vmid);
    }
    return c.updateMethod !== "unknown";
  });

  if (automation.onlyRunning) {
    targets = targets.filter((c) => c.status === "running");
  }

  if (automation.onlyWhenUpdatesAvailable) {
    targets = targets.filter((c) => c.updateAvailable === true);
  }

  const finishedAt = new Date().toISOString();

  if (targets.length === 0) {
    await updateState((s) => ({
      ...s,
      automations: s.automations.map((a) =>
        a.id === automationId ? { ...a, lastRunAt: finishedAt } : a,
      ),
    }));
    return;
  }

  await enqueueUpdates({
    vmids: targets.map((t) => t.vmid),
    trigger: "automation",
    automationId,
    staggerSeconds: automation.staggerSeconds,
  });

  await updateState((s) => ({
    ...s,
    automations: s.automations.map((a) =>
      a.id === automationId ? { ...a, lastRunAt: finishedAt } : a,
    ),
  }));
}

function scheduleOne(automation: Automation) {
  const existing = tasks.get(automation.id);
  if (existing) {
    existing.stop();
    tasks.delete(automation.id);
  }

  if (!automation.enabled) return;
  if (!validate(automation.cron)) return;

  const task = schedule(automation.cron, () => {
    void runAutomation(automation.id);
  });
  tasks.set(automation.id, task);
}

export async function refreshSchedules() {
  const state = await readState();
  const ids = new Set(state.automations.map((a) => a.id));

  for (const [id, task] of tasks) {
    if (!ids.has(id)) {
      task.stop();
      tasks.delete(id);
    }
  }

  for (const automation of state.automations) {
    scheduleOne(automation);
  }
}

export async function startScheduler() {
  if (started) return;
  started = true;
  await refreshSchedules();
}

export async function triggerAutomationNow(automationId: string) {
  await runAutomation(automationId);
}
