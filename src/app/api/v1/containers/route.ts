import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-auth";
import { getContainers } from "@/lib/updater";

export async function GET(request: Request) {
  const auth = await requireApiKey(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const check = searchParams.get("check") === "1";
  const refresh = searchParams.get("refresh") === "1";
  const availableOnly = searchParams.get("available") === "1";
  const node = searchParams.get("node");

  let containers = await getContainers({
    refreshMethods: refresh,
    checkUpdates: check,
  });

  if (node) {
    containers = containers.filter((c) => c.node === node);
  }
  if (availableOnly) {
    containers = containers.filter((c) => c.updateAvailable === true);
  }

  return NextResponse.json({ containers });
}
