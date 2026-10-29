import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getJobs } from "@/lib/updater";

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const jobs = await getJobs();
  return NextResponse.json({ jobs });
}
