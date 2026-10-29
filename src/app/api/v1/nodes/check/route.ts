import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";
import { checkUpdatesForNodes } from "@/lib/node-updater";

export async function POST(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  try {
    const nodes = await checkUpdatesForNodes();
    return NextResponse.json({
      nodes,
      updatesAvailable: nodes.filter((n) => n.updateAvailable).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
