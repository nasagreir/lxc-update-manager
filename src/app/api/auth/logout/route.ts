import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/session";

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  return clearSessionCookie(response, request);
}
