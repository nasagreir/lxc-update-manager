import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueUpdates } from "@/lib/updater";


const bodySchema = z.object({
  vmids: z.array(z.number().int().positive()).min(1),
  staggerSeconds: z.number().int().min(0).max(3600).optional(),
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const body = bodySchema.parse(json);
    const jobs = await enqueueUpdates({
      vmids: body.vmids,
      trigger: "manual",
      staggerSeconds: body.staggerSeconds ?? 5,
    });
    return NextResponse.json({ jobs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
