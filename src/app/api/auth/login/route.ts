import { NextResponse } from "next/server";
import { z } from "zod";
import { isPasswordConfigured, verifyPassword } from "@/lib/auth/password";
import {
  attachSessionCookie,
  createSessionToken,
} from "@/lib/auth/session";
import { readState } from "@/lib/store/db";

const bodySchema = z.object({
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  try {
    if (!(await isPasswordConfigured())) {
      return NextResponse.json(
        {
          error: "Password not set yet",
          code: "SETUP_REQUIRED",
        },
        { status: 409 },
      );
    }

    const parsed = bodySchema.parse(await request.json());
    const state = await readState();
    if (!verifyPassword(parsed.password, state.auth) || !state.auth.sessionSecret) {
      return NextResponse.json(
        { error: "Incorrect password" },
        { status: 401 },
      );
    }

    const token = createSessionToken(state.auth.sessionSecret);
    const response = NextResponse.json({ ok: true });
    return attachSessionCookie(response, token, request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
