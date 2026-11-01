import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { rollbackContainer } from "@/lib/updater";

const bodySchema = z.object({
  vmid: z.number().int().positive(),
});

/** Roll a container back to its latest pre-update Proxmox snapshot. */
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const body = bodySchema.parse(await request.json());
    const result = await rollbackContainer(body.vmid);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
