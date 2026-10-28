import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-auth";
import { enqueueUpdates, getContainers } from "@/lib/updater";

const bodySchema = z.object({
  vmids: z.array(z.number().int().positive()).optional(),
  /** If true, update every CT currently marked updateAvailable. */
  allAvailable: z.boolean().optional(),
  staggerSeconds: z.number().int().min(0).max(3600).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    let vmids = body.vmids ?? [];

    if (body.allAvailable) {
      const containers = await getContainers();
      vmids = containers
        .filter((c) => c.updateAvailable === true)
        .map((c) => c.vmid);
    }

    if (vmids.length === 0) {
      return NextResponse.json(
        { error: "No containers to update. Pass vmids or allAvailable: true." },
        { status: 400 },
      );
    }

    const jobs = await enqueueUpdates({
      vmids,
      trigger: "api",
      staggerSeconds: body.staggerSeconds ?? 5,
    });

    return NextResponse.json({ jobs, count: jobs.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
