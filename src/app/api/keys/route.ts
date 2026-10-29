import { NextResponse } from "next/server";
import { z } from "zod";
import { createApiKey, listApiKeys } from "@/lib/api-keys";
import { requireSession } from "@/lib/auth/require-session";

const createSchema = z.object({
  name: z.string().min(1).max(80).default("Grok bot"),
});

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const keys = await listApiKeys();
  return NextResponse.json({
    keys: keys.map(({ keyHash: _h, ...rest }) => rest),
  });
}

export async function POST(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const body = createSchema.parse(await request.json().catch(() => ({})));
    const { key, secret } = await createApiKey(body.name);
    const { keyHash: _h, ...safe } = key;
    return NextResponse.json({
      key: safe,
      /** Shown once — store it; it cannot be retrieved again. */
      secret,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
