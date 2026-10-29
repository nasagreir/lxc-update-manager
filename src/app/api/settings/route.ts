import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { readState, updateState } from "@/lib/store/db";

const settingsSchema = z.object({
  mockMode: z.boolean(),
  proxmoxHost: z.string().min(1),
  proxmoxPort: z.number().int().min(1).max(65535),
  proxmoxVerifyTls: z.boolean(),
  apiTokenId: z.string(),
  apiTokenSecret: z.string(),
  defaultNode: z.string().optional().default(""),
  includeNodes: z.string().optional().default(""),
  execMode: z.enum(["ssh", "local"]),
  sshHost: z.string(),
  sshPort: z.number().int().min(1).max(65535),
  sshUser: z.string(),
  sshPrivateKeyPath: z.string(),
  nodeSshHosts: z.string().optional().default(""),
  updateTimeoutSeconds: z.number().int().min(60).max(86400),
  communityScriptAnswers: z.string(),
});

function redact(settings: Awaited<ReturnType<typeof readState>>["settings"]) {
  return {
    ...settings,
    apiTokenSecret: settings.apiTokenSecret
      ? "••••••••" + settings.apiTokenSecret.slice(-4)
      : "",
    hasApiTokenSecret: Boolean(settings.apiTokenSecret),
  };
}

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  const state = await readState();
  return NextResponse.json({ settings: redact(state.settings) });
}

export async function PUT(request: Request) {
  const auth = await requireSession(request);
  if (!auth.ok) return auth.response;
  try {
    const json = await request.json();
    const parsed = settingsSchema.parse(json);

    const state = await updateState((s) => {
      const secret =
        parsed.apiTokenSecret.startsWith("••••••••") ||
        parsed.apiTokenSecret === ""
          ? s.settings.apiTokenSecret
          : parsed.apiTokenSecret;
      return {
        ...s,
        settings: { ...parsed, apiTokenSecret: secret },
      };
    });

    return NextResponse.json({ settings: redact(state.settings) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
