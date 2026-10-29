import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "@/lib/auth/constants";
import { readState } from "@/lib/store/db";

export { SESSION_COOKIE, SESSION_TTL_SECONDS };

type SessionPayload = {
  exp: number;
  iat: number;
};

function b64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf.toString("base64url");
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function createSessionToken(sessionSecret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = sign(payloadB64, sessionSecret);
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(
  token: string,
  sessionSecret: string,
): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;
  const expected = sign(payloadB64, sessionSecret);
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (
      typeof payload.exp !== "number" ||
      typeof payload.iat !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure,
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function isSecureRequest(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0]?.trim() === "https";
  return new URL(request.url).protocol === "https:";
}

export function attachSessionCookie(
  response: NextResponse,
  token: string,
  request: Request,
): NextResponse {
  response.cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(isSecureRequest(request)),
  );
  return response;
}

export function clearSessionCookie(
  response: NextResponse,
  request: Request,
): NextResponse {
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(isSecureRequest(request)),
    maxAge: 0,
  });
  return response;
}

/** Read + verify the session cookie in a Server Component / Route Handler. */
export async function getSession(): Promise<SessionPayload | null> {
  const state = await readState();
  if (!state.auth.sessionSecret || !state.auth.passwordHash) return null;
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token, state.auth.sessionSecret);
}

export async function getSessionFromRequest(
  request: Request,
): Promise<SessionPayload | null> {
  const state = await readState();
  if (!state.auth.sessionSecret || !state.auth.passwordHash) return null;
  const token = parseCookieHeader(request.headers.get("cookie"))[SESSION_COOKIE];
  if (!token) return null;
  return verifySessionToken(token, state.auth.sessionSecret);
}

function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}
