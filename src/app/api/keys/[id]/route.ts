import { NextResponse } from "next/server";
import { revokeApiKey } from "@/lib/api-keys";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const ok = await revokeApiKey(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ revoked: true });
}
