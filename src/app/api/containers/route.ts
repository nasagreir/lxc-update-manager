import { NextResponse } from "next/server";
import { getContainers } from "@/lib/updater";


export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get("refresh") === "1";
    const containers = await getContainers({ refreshMethods: refresh });
    return NextResponse.json({ containers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
