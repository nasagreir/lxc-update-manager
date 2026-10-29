import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_USERNAME } from "@/lib/auth/constants";
import {
  isPasswordConfigured,
  verifyPassword,
  verifyUsername,
} from "@/lib/auth/password";
import {
  attachSessionCookie,
  createSessionToken,
} from "@/lib/auth/session";
import { readState } from "@/lib/store/db";

const bodySchema = z.object({
  username: z.string().min(1).max(64).default(DEFAULT_USERNAME),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  try {
    if (!(await isPasswordConfigured())) {
      return NextResponse.json(
        {
          error: "Login not set yet",
          code: "SETUP_REQUIRED",
        },
        { status: 409 },
      );
    }

    const parsed = bodySchema.parse(await request.json());
    const state = await readState();
    const userOk = verifyUsername(parsed.username, state.auth);
    const passOk = verifyPassword(parsed.password, state.auth);
    if (!userOk || !passOk || !state.auth.sessionSecret) {
      return NextResponse.json(
        { error: "Incorrect username or password" },
        { status: 401 },
      );
    }

    const token = createSessionToken(state.auth.sessionSecret);
    const response = NextResponse.json({
      ok: true,
      username: state.auth.username,
    });
    return attachSessionCookie(response, token, request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
