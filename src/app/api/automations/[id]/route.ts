import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { readState, updateState } from "@/lib/store/db";
import {
  presetToCron,
  refreshSchedules,
  triggerAutomationNow,
} from "@/lib/scheduler";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  schedulePreset: z.enum(["daily", "weekly", "monthly", "custom"]).optional(),
  cron: z.string().optional(),
  containerIds: z.array(z.number().int().positive()).optional(),
  onlyRunning: z.boolean().optional(),
  checkBeforeRun: z.boolean().optional(),
  onlyWhenUpdatesAvailable: z.boolean().optional(),
  staggerSeconds: z.number().int().min(0).max(3600).optional(),
  runNow: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    const body = patchSchema.parse(await request.json());

    if (body.runNow) {
      await triggerAutomationNow(id);
      const state = await readState();
      const automation = state.automations.find((a) => a.id === id);
      return NextResponse.json({ automation, triggered: true });
    }

    const state = await updateState((s) => {
      const automations = s.automations.map((a) => {
        if (a.id !== id) return a;
        const schedulePreset = body.schedulePreset ?? a.schedulePreset;
        const cron =
          schedulePreset === "custom"
            ? body.cron ?? a.cron
            : body.schedulePreset
              ? presetToCron(schedulePreset)
              : a.cron;
        return {
          ...a,
          name: body.name ?? a.name,
          enabled: body.enabled ?? a.enabled,
          schedulePreset,
          cron,
          containerIds: body.containerIds ?? a.containerIds,
          onlyRunning: body.onlyRunning ?? a.onlyRunning,
          checkBeforeRun: body.checkBeforeRun ?? a.checkBeforeRun,
          onlyWhenUpdatesAvailable:
            body.onlyWhenUpdatesAvailable ?? a.onlyWhenUpdatesAvailable,
          staggerSeconds: body.staggerSeconds ?? a.staggerSeconds,
          updatedAt: new Date().toISOString(),
        };
      });
      return { ...s, automations };
    });

    await refreshSchedules();
    const automation = state.automations.find((a) => a.id === id);
    if (!automation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ automation });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const state = await updateState((s) => ({
    ...s,
    automations: s.automations.filter((a) => a.id !== id),
  }));
  await refreshSchedules();
  return NextResponse.json({ automations: state.automations });
}
