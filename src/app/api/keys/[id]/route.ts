import { NextResponse } from "next/server";
import { revokeApiKey } from "@/lib/api-keys";
import { requireSession } from "@/lib/auth/require-session";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const ok = await revokeApiKey(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ revoked: true });
}
