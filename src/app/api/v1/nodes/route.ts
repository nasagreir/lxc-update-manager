import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";
import { getNodes } from "@/lib/node-updater";

export async function GET(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const check = url.searchParams.get("check") === "1";
    const availableOnly = url.searchParams.get("available") === "1";
    let nodes = await getNodes({ checkUpdates: check });
    if (availableOnly) {
      nodes = nodes.filter((n) => n.updateAvailable === true);
    }
    return NextResponse.json({ nodes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
