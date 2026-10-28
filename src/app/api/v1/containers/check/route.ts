import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";
import { checkUpdatesForContainers } from "@/lib/updater";

export async function POST(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  const containers = await checkUpdatesForContainers();
  const available = containers.filter((c) => c.updateAvailable === true);

  return NextResponse.json({
    containers,
    updatesAvailable: available.length,
    available: available.map((c) => ({
      vmid: c.vmid,
      name: c.name,
      node: c.node,
      detail: c.updateAvailableDetail,
      pendingUpdateCount: c.pendingUpdateCount,
    })),
  });
}
