import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getContainers } from "@/lib/updater";

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get("refresh") === "1";
    const check = searchParams.get("check") === "1";
    const containers = await getContainers({
      refreshMethods: refresh,
      checkUpdates: check,
    });
    return NextResponse.json({ containers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
