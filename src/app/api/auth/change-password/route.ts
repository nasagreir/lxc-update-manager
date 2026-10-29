import { NextResponse } from "next/server";
import { z } from "zod";
import {
  changePassword,
  MIN_PASSWORD_LENGTH,
} from "@/lib/auth/password";
import { requireSession } from "@/lib/auth/require-session";
import {
  attachSessionCookie,
  createSessionToken,
} from "@/lib/auth/session";
import { readState } from "@/lib/store/db";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  confirmPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});

export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    const parsed = bodySchema.parse(await request.json());
    if (parsed.newPassword !== parsed.confirmPassword) {
      return NextResponse.json(
        { error: "Passwords do not match" },
        { status: 400 },
      );
    }

    await changePassword(parsed.currentPassword, parsed.newPassword);
    const state = await readState();
    if (!state.auth.sessionSecret) {
      return NextResponse.json(
        { error: "Failed to refresh session" },
        { status: 500 },
      );
    }

    const token = createSessionToken(state.auth.sessionSecret);
    const response = NextResponse.json({ ok: true });
    return attachSessionCookie(response, token, request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("incorrect") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
