import { NextResponse } from "next/server";
import { isPasswordConfigured } from "@/lib/auth/password";
import { getSessionFromRequest } from "@/lib/auth/session";

/**
 * Require a valid UI login session for dashboard /api/* routes.
 * API keys (/api/v1/*) are unaffected.
 */
export async function requireSession(
  request: Request,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (!(await isPasswordConfigured())) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Password setup required",
          code: "SETUP_REQUIRED",
        },
        { status: 401 },
      ),
    };
  }

  const session = await getSessionFromRequest(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Not authenticated",
          code: "UNAUTHENTICATED",
        },
        { status: 401 },
      ),
    };
  }

  return { ok: true };
}
