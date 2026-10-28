import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { readState, updateState } from "@/lib/store/db";
import type { ApiKeyRecord } from "@/lib/types";

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function generateApiKeySecret(): {
  raw: string;
  prefix: string;
  hash: string;
} {
  const raw = `lxcu_${randomBytes(24).toString("base64url")}`;
  return {
    raw,
    prefix: `${raw.slice(0, 12)}…`,
    hash: hashApiKey(raw),
  };
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  const state = await readState();
  return state.apiKeys.filter((k) => !k.revokedAt);
}

export async function createApiKey(name: string): Promise<{
  key: ApiKeyRecord;
  secret: string;
}> {
  const { raw, prefix, hash } = generateApiKeySecret();
  const record: ApiKeyRecord = {
    id: randomUUID(),
    name: name.trim() || "API key",
    prefix,
    keyHash: hash,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };
  await updateState((s) => ({
    ...s,
    apiKeys: [record, ...s.apiKeys],
  }));
  return { key: record, secret: raw };
}

export async function revokeApiKey(id: string): Promise<boolean> {
  let found = false;
  await updateState((s) => ({
    ...s,
    apiKeys: s.apiKeys.map((k) => {
      if (k.id !== id || k.revokedAt) return k;
      found = true;
      return { ...k, revokedAt: new Date().toISOString() };
    }),
  }));
  return found;
}

/** Extract bearer / x-api-key from a request. */
export function extractApiKeyFromRequest(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const header = request.headers.get("x-api-key")?.trim();
  return header || null;
}

export async function verifyApiKey(
  raw: string,
): Promise<ApiKeyRecord | null> {
  if (!raw.startsWith("lxcu_")) return null;
  const hash = hashApiKey(raw);
  const state = await readState();
  const match = state.apiKeys.find(
    (k) => !k.revokedAt && safeEqualHex(k.keyHash, hash),
  );
  if (!match) return null;

  // Touch lastUsedAt (fire-and-forget style via await for consistency)
  await updateState((s) => ({
    ...s,
    apiKeys: s.apiKeys.map((k) =>
      k.id === match.id
        ? { ...k, lastUsedAt: new Date().toISOString() }
        : k,
    ),
  }));

  return match;
}
