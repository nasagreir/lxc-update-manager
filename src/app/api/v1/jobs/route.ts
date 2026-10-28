import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";
import { getJobs } from "@/lib/updater";

export async function GET(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Number(searchParams.get("limit") || 50) || 50,
    200,
  );
  const status = searchParams.get("status");

  let jobs = await getJobs();
  if (status) {
    jobs = jobs.filter((j) => j.status === status);
  }
  return NextResponse.json({ jobs: jobs.slice(0, limit) });
}
