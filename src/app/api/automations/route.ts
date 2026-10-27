import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readState, updateState } from "@/lib/store/db";
import { presetToCron, refreshSchedules } from "@/lib/scheduler";
import type { Automation } from "@/lib/types";


const createSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  schedulePreset: z.enum(["daily", "weekly", "monthly", "custom"]),
  cron: z.string().optional(),
  containerIds: z.array(z.number().int().positive()).default([]),
  onlyRunning: z.boolean().default(true),
  staggerSeconds: z.number().int().min(0).max(3600).default(30),
});

export async function GET() {
  const state = await readState();
  return NextResponse.json({ automations: state.automations });
}

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await request.json());
    const cron =
      body.schedulePreset === "custom"
        ? body.cron || "0 3 * * *"
        : presetToCron(body.schedulePreset);

    const now = new Date().toISOString();
    const automation: Automation = {
      id: randomUUID(),
      name: body.name,
      enabled: body.enabled,
      cron,
      schedulePreset: body.schedulePreset,
      containerIds: body.containerIds,
      onlyRunning: body.onlyRunning,
      staggerSeconds: body.staggerSeconds,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      nextRunAt: null,
    };

    const state = await updateState((s) => ({
      ...s,
      automations: [...s.automations, automation],
    }));
    await refreshSchedules();

    return NextResponse.json({ automation, automations: state.automations });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
