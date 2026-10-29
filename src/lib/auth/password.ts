import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/constants";
import { readState, updateState } from "@/lib/store/db";
import type { AuthState } from "@/lib/types";

export { MIN_PASSWORD_LENGTH };

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export function validatePassword(password: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 200) {
    return "Password is too long";
  }
  return null;
}

export function hashPassword(
  password: string,
  saltHex?: string,
): { hash: string; salt: string } {
  const salt = saltHex
    ? Buffer.from(saltHex, "hex")
    : randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS);
  return {
    hash: hash.toString("hex"),
    salt: salt.toString("hex"),
  };
}

export function verifyPassword(
  password: string,
  auth: Pick<AuthState, "passwordHash" | "passwordSalt">,
): boolean {
  if (!auth.passwordHash || !auth.passwordSalt) return false;
  try {
    const { hash } = hashPassword(password, auth.passwordSalt);
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(auth.passwordHash, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function newSessionSecret(): string {
  return randomBytes(32).toString("hex");
}

export async function isPasswordConfigured(): Promise<boolean> {
  const state = await readState();
  return Boolean(state.auth.passwordHash && state.auth.passwordSalt);
}

/**
 * Set or replace the UI password. Always rotates the session secret so
 * existing login cookies stop working.
 */
export async function setPassword(password: string): Promise<void> {
  const err = validatePassword(password);
  if (err) throw new Error(err);
  const { hash, salt } = hashPassword(password);
  await updateState((s) => ({
    ...s,
    auth: {
      passwordHash: hash,
      passwordSalt: salt,
      sessionSecret: newSessionSecret(),
      passwordSetAt: new Date().toISOString(),
    },
  }));
}

export async function changePassword(
  currentPassword: string,
  nextPassword: string,
): Promise<void> {
  const state = await readState();
  if (!verifyPassword(currentPassword, state.auth)) {
    throw new Error("Current password is incorrect");
  }
  await setPassword(nextPassword);
}
