import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import {
  DEFAULT_USERNAME,
  MAX_USERNAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  MIN_USERNAME_LENGTH,
} from "@/lib/auth/constants";
import { readState, updateState } from "@/lib/store/db";
import type { AuthState } from "@/lib/types";

export { MIN_PASSWORD_LENGTH, MIN_USERNAME_LENGTH, MAX_USERNAME_LENGTH };

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export function validateUsername(username: string): string | null {
  const trimmed = username.trim();
  if (trimmed.length < MIN_USERNAME_LENGTH) {
    return "Username is required";
  }
  if (trimmed.length > MAX_USERNAME_LENGTH) {
    return `Username must be at most ${MAX_USERNAME_LENGTH} characters`;
  }
  if (!/^[a-zA-Z0-9._@-]+$/.test(trimmed)) {
    return "Username may only contain letters, numbers, and . _ @ -";
  }
  return null;
}

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
  const salt = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(16);
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

function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // Still do a compare to reduce trivial timing leaks on length.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function verifyUsername(
  username: string,
  auth: Pick<AuthState, "username">,
): boolean {
  const expected = (auth.username || DEFAULT_USERNAME).trim();
  return safeEqualString(username.trim(), expected);
}

export function newSessionSecret(): string {
  return randomBytes(32).toString("hex");
}

export async function isPasswordConfigured(): Promise<boolean> {
  const state = await readState();
  return Boolean(state.auth.passwordHash && state.auth.passwordSalt);
}

export async function getUsername(): Promise<string> {
  const state = await readState();
  return state.auth.username?.trim() || DEFAULT_USERNAME;
}

/**
 * Set or replace UI credentials. Always rotates the session secret so
 * existing login cookies stop working.
 */
export async function setCredentials(opts: {
  username: string;
  password: string;
}): Promise<void> {
  const userErr = validateUsername(opts.username);
  if (userErr) throw new Error(userErr);
  const passErr = validatePassword(opts.password);
  if (passErr) throw new Error(passErr);
  const { hash, salt } = hashPassword(opts.password);
  await updateState((s) => ({
    ...s,
    auth: {
      username: opts.username.trim(),
      passwordHash: hash,
      passwordSalt: salt,
      sessionSecret: newSessionSecret(),
      passwordSetAt: new Date().toISOString(),
    },
  }));
}

/** @deprecated use setCredentials */
export async function setPassword(password: string): Promise<void> {
  const username = await getUsername();
  await setCredentials({ username, password });
}

export async function changeCredentials(opts: {
  currentPassword: string;
  username?: string;
  newPassword?: string;
}): Promise<void> {
  const state = await readState();
  if (!verifyPassword(opts.currentPassword, state.auth)) {
    throw new Error("Current password is incorrect");
  }

  const nextUsername = (opts.username ?? state.auth.username ?? DEFAULT_USERNAME).trim();
  const userErr = validateUsername(nextUsername);
  if (userErr) throw new Error(userErr);

  let passwordHash = state.auth.passwordHash;
  let passwordSalt = state.auth.passwordSalt;
  if (opts.newPassword != null && opts.newPassword !== "") {
    const passErr = validatePassword(opts.newPassword);
    if (passErr) throw new Error(passErr);
    const hashed = hashPassword(opts.newPassword);
    passwordHash = hashed.hash;
    passwordSalt = hashed.salt;
  }

  await updateState((s) => ({
    ...s,
    auth: {
      username: nextUsername,
      passwordHash,
      passwordSalt,
      sessionSecret: newSessionSecret(),
      passwordSetAt: new Date().toISOString(),
    },
  }));
}

export async function changePassword(
  currentPassword: string,
  nextPassword: string,
): Promise<void> {
  await changeCredentials({
    currentPassword,
    newPassword: nextPassword,
  });
}
