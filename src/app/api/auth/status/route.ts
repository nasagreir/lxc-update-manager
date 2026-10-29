import { NextResponse } from "next/server";
import { getUsername, isPasswordConfigured } from "@/lib/auth/password";
import { getSessionFromRequest } from "@/lib/auth/session";

export async function GET(request: Request) {
  const setupRequired = !(await isPasswordConfigured());
  const session = setupRequired ? null : await getSessionFromRequest(request);
  const username = await getUsername();
  return NextResponse.json({
    setupRequired,
    authenticated: Boolean(session),
    username,
  });
}
