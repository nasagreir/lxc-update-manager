import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";
import { getJob } from "@/lib/updater";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ job });
}
