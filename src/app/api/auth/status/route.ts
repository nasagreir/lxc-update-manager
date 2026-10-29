import { NextResponse } from "next/server";
import { isPasswordConfigured } from "@/lib/auth/password";
import { getSessionFromRequest } from "@/lib/auth/session";

export async function GET(request: Request) {
  const setupRequired = !(await isPasswordConfigured());
  const session = setupRequired ? null : await getSessionFromRequest(request);
  return NextResponse.json({
    setupRequired,
    authenticated: Boolean(session),
  });
}
