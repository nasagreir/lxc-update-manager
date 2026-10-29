import { NextResponse } from "next/server";
import { getNodes } from "@/lib/node-updater";

export async function GET(request: Request) {
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
