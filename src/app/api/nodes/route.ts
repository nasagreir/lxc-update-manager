import { NextResponse } from "next/server";
import { listNodes } from "@/lib/proxmox/client";
import { readState } from "@/lib/store/db";

export async function GET() {
  try {
    const state = await readState();
    const nodes = await listNodes(state.settings);
    return NextResponse.json({ nodes });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, nodes: [] }, { status: 500 });
  }
}
