import { NextResponse } from "next/server";
import {
  extractApiKeyFromRequest,
  verifyApiKey,
} from "@/lib/api-keys";
import type { ApiKeyRecord } from "@/lib/types";

export type AuthedRequest = {
  key: ApiKeyRecord;
};

/**
 * Require a valid LXC Updater API key (Bearer or X-Api-Key).
 * Used by /api/v1/* routes for Grok bot and other integrations.
 */
export async function requireApiKey(
  request: Request,
): Promise<{ ok: true; key: ApiKeyRecord } | { ok: false; response: NextResponse }> {
  const raw = extractApiKeyFromRequest(request);
  if (!raw) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Missing API key",
          hint: "Send Authorization: Bearer lxcu_… or X-Api-Key: lxcu_…",
        },
        { status: 401 },
      ),
    };
  }

  const key = await verifyApiKey(raw);
  if (!key) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or revoked API key" },
        { status: 401 },
      ),
    };
  }

  return { ok: true, key };
}
