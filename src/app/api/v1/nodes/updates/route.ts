import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-auth";
import { enqueueNodeUpdates, getNodes } from "@/lib/node-updater";

const bodySchema = z.object({
  nodes: z.array(z.string().min(1)).optional(),
  allAvailable: z.boolean().optional(),
  staggerSeconds: z.number().int().min(0).max(3600).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    let names = body.nodes ?? [];

    if (body.allAvailable) {
      const cluster = await getNodes();
      names = cluster.filter((n) => n.updateAvailable).map((n) => n.name);
    }

    if (names.length === 0) {
      return NextResponse.json(
        { error: "No nodes selected for update" },
        { status: 400 },
      );
    }

    const jobs = await enqueueNodeUpdates({
      nodes: names,
      trigger: "api",
      staggerSeconds: body.staggerSeconds ?? 30,
    });

    return NextResponse.json({ jobs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
