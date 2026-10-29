import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getNodes } from "@/lib/node-updater";

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const check = url.searchParams.get("check") === "1";
    const nodes = await getNodes({ checkUpdates: check });
    return NextResponse.json({ nodes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, nodes: [] }, { status: 500 });
  }
}
