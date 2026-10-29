import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";
import { getNodes } from "@/lib/node-updater";
import { readState } from "@/lib/store/db";
import { getContainers, getJobs } from "@/lib/updater";

export async function GET(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  const [containers, nodes, jobs, state] = await Promise.all([
    getContainers(),
    getNodes(),
    getJobs(),
    readState(),
  ]);

  const running = containers.filter((c) => c.status === "running").length;
  const updatesAvailable = containers.filter((c) => c.updateAvailable).length;
  const hostUpdatesAvailable = nodes.filter((n) => n.updateAvailable).length;
  const activeJobs = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  ).length;

  return NextResponse.json({
    ok: true,
    mockMode: state.settings.mockMode,
    summary: {
      containers: containers.length,
      running,
      updatesAvailable,
      hostUpdatesAvailable,
      activeJobs,
      nodes: nodes.map((n) => n.name),
      automations: state.automations.filter((a) => a.enabled).length,
    },
    authenticatedAs: auth.key.name,
  });
}
