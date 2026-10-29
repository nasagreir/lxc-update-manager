import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
} from "@/lib/auth/constants";
import { changeCredentials } from "@/lib/auth/password";
import { requireSession } from "@/lib/auth/require-session";
import {
  attachSessionCookie,
  createSessionToken,
} from "@/lib/auth/session";
import { readState } from "@/lib/store/db";

const bodySchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    username: z
      .string()
      .min(MIN_USERNAME_LENGTH)
      .max(MAX_USERNAME_LENGTH)
      .optional(),
    newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200).optional(),
    confirmPassword: z.string().max(200).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.newPassword != null && val.newPassword !== "") {
      if (val.newPassword !== (val.confirmPassword ?? "")) {
        ctx.addIssue({
          code: "custom",
          message: "Passwords do not match",
          path: ["confirmPassword"],
        });
      }
    }
    if (
      (val.username == null || val.username.trim() === "") &&
      (val.newPassword == null || val.newPassword === "")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Provide a new username and/or a new password",
      });
    }
  });

/** Update username and/or password (requires current password). */
export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;

  try {
    const parsed = bodySchema.parse(await request.json());
    await changeCredentials({
      currentPassword: parsed.currentPassword,
      username: parsed.username,
      newPassword: parsed.newPassword,
    });
    const state = await readState();
    if (!state.auth.sessionSecret) {
      return NextResponse.json(
        { error: "Failed to refresh session" },
        { status: 500 },
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
    const status = message.includes("incorrect") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
