#!/usr/bin/env node
/**
 * Set / reset the LXC Updater web UI password from the CT console.
 *
 * Usage:
 *   lxc-updater-passwd              Interactive set (asks current if set)
 *   lxc-updater-passwd --reset      Force set without current password
 *   lxc-updater-passwd --check      Exit 0 if a password is configured
 *
 * Writes auth fields into $LXC_UPDATER_DATA_DIR/state.json (default
 * /opt/lxc-updater-data/state.json) and rotates the session secret so
 * existing browser logins are invalidated.
 */
import { createInterface } from "readline";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { spawnSync } from "child_process";
import { stdin as input, stdout as output, stderr } from "process";

const MIN_LEN = 8;
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const DATA_DIR =
  process.env.LXC_UPDATER_DATA_DIR || "/opt/lxc-updater-data";
const STATE_FILE = join(DATA_DIR, "state.json");

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const wantHelp = args.has("-h") || args.has("--help");
const wantCheck = args.has("--check");
const wantReset = args.has("--reset") || args.has("-r");
const passwordEq = rawArgs.find((a) => a.startsWith("--password="));
const passwordFlagIdx = rawArgs.indexOf("--password");
const passwordFromFlag =
  passwordEq?.slice("--password=".length) ||
  (passwordFlagIdx >= 0 ? rawArgs[passwordFlagIdx + 1] : undefined) ||
  process.env.LXC_UPDATER_PASSWORD ||
  "";

if (wantHelp) {
  console.log(`Usage:
  lxc-updater-passwd           Set or change the web UI password
  lxc-updater-passwd --reset   Set a new password (no current password needed)
  lxc-updater-passwd --check   Exit 0 if a password is already configured

Non-interactive:
  LXC_UPDATER_PASSWORD='…' lxc-updater-passwd --reset
  lxc-updater-passwd --reset --password '…'
`);
  process.exit(0);
}

function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS);
  return { hash: hash.toString("hex"), salt: salt.toString("hex") };
}

function verifyPassword(password, auth) {
  if (!auth?.passwordHash || !auth?.passwordSalt) return false;
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

function readState() {
  if (!existsSync(STATE_FILE)) {
    return {
      settings: {},
      auth: {
        passwordHash: null,
        passwordSalt: null,
        sessionSecret: null,
        passwordSetAt: null,
      },
      automations: [],
      jobs: [],
      apiKeys: [],
      containerMeta: {},
      nodeMeta: {},
    };
  }
  const raw = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  return {
    ...raw,
    auth: {
      passwordHash: null,
      passwordSalt: null,
      sessionSecret: null,
      passwordSetAt: null,
      ...(raw.auth ?? {}),
    },
  };
}

function writeState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, STATE_FILE);
}

function ask(rl, prompt, { silent = false } = {}) {
  // Pipes / non-TTY: normal readline (echo). Interactive TTY: hide password.
  if (!silent || !input.isTTY || typeof input.setRawMode !== "function") {
    return new Promise((resolve) => {
      rl.question(prompt, (answer) => resolve(String(answer ?? "").replace(/\r$/, "")));
    });
  }
  return new Promise((resolve) => {
    const wasRaw = Boolean(input.isRaw);
    let buf = "";
    const onData = (chunk) => {
      const s = chunk.toString("utf8");
      if (s === "\n" || s === "\r" || s === "\u0004") {
        input.setRawMode(wasRaw);
        input.removeListener("data", onData);
        output.write("\n");
        resolve(buf);
        return;
      }
      if (s === "\u0003") {
        input.setRawMode(wasRaw);
        input.removeListener("data", onData);
        output.write("\n");
        process.exit(1);
      }
      if (s === "\u007f" || s === "\b") {
        buf = buf.slice(0, -1);
        return;
      }
      if (s < " " && s !== "\t") return;
      buf += s;
    };
    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function main() {
  const state = readState();
  const configured = Boolean(
    state.auth.passwordHash && state.auth.passwordSalt,
  );

  if (wantCheck) {
    process.exit(configured ? 0 : 1);
  }

  const rl = createInterface({ input, output, terminal: true });
  try {
    console.log("LXC Updater — web UI password");
    console.log(`Data file: ${STATE_FILE}`);
    console.log();

    if (configured && !wantReset) {
      const current = await ask(rl, "Current password: ", { silent: true });
      if (!verifyPassword(current, state.auth)) {
        stderr.write("Current password is incorrect.\n");
        stderr.write("Use --reset to set a new password without the old one.\n");
        process.exit(1);
      }
    } else if (wantReset && configured) {
      console.log("Reset mode: current password will not be checked.");
    } else if (!configured) {
      console.log("No password set yet — creating the initial admin password.");
    }

    let next = passwordFromFlag;
    if (next) {
      console.log("Using password from --password / LXC_UPDATER_PASSWORD.");
    } else {
      next = await ask(rl, "New password: ", { silent: true });
      if (next.length < MIN_LEN) {
        stderr.write(`Password must be at least ${MIN_LEN} characters.\n`);
        process.exit(1);
      }
      const confirm = await ask(rl, "Confirm password: ", { silent: true });
      if (next !== confirm) {
        stderr.write("Passwords do not match.\n");
        process.exit(1);
      }
    }
    if (next.length < MIN_LEN) {
      stderr.write(`Password must be at least ${MIN_LEN} characters.\n`);
      process.exit(1);
    }

    const { hash, salt } = hashPassword(next);
    state.auth = {
      passwordHash: hash,
      passwordSalt: salt,
      sessionSecret: randomBytes(32).toString("hex"),
      passwordSetAt: new Date().toISOString(),
    };
    writeState(state);
    // Drop the app's in-memory state cache so the new hash is used immediately.
    const restart = spawnSync(
      "systemctl",
      ["try-restart", "lxc-updater.service"],
      { encoding: "utf8" },
    );
    console.log();
    console.log("Password saved. Existing browser sessions were signed out.");
    if (restart.status === 0) {
      console.log("Restarted lxc-updater.service.");
    } else {
      console.log(
        "Could not restart lxc-updater automatically — run: systemctl restart lxc-updater",
      );
    }
    console.log("Open the web UI and sign in with the new password.");
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
