import { NextResponse } from "next/server";
import { z } from "zod";
import {
  isPasswordConfigured,
  MIN_PASSWORD_LENGTH,
  setPassword,
} from "@/lib/auth/password";
import {
  attachSessionCookie,
  createSessionToken,
} from "@/lib/auth/session";
import { readState } from "@/lib/store/db";

const bodySchema = z.object({
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  confirmPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});

/** First-run only: set the initial UI password and create a session. */
export async function POST(request: Request) {
  try {
    if (await isPasswordConfigured()) {
      return NextResponse.json(
        { error: "Password already configured. Use login instead." },
        { status: 409 },
      );
    }

    const parsed = bodySchema.parse(await request.json());
    if (parsed.password !== parsed.confirmPassword) {
      return NextResponse.json(
        { error: "Passwords do not match" },
        { status: 400 },
      );
    }

    await setPassword(parsed.password);
    const state = await readState();
    if (!state.auth.sessionSecret) {
      return NextResponse.json(
        { error: "Failed to initialize session" },
        { status: 500 },
      );
    }

    const token = createSessionToken(state.auth.sessionSecret);
    const response = NextResponse.json({ ok: true, setupRequired: false });
    return attachSessionCookie(response, token, request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
