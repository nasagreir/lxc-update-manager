import { spawn } from "child_process";
import type { AppSettings } from "@/lib/types";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        code: 1,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
        timedOut,
      });
    });
  });
}

/**
 * Run a command inside an LXC via `pct exec` on the Proxmox host.
 */
export async function pctExec(
  settings: AppSettings,
  vmid: number,
  remoteCommand: string[],
  timeoutSeconds?: number,
): Promise<ExecResult> {
  const timeoutMs = (timeoutSeconds ?? settings.updateTimeoutSeconds) * 1000;
  const pctArgs = ["exec", String(vmid), "--", ...remoteCommand];

  if (settings.execMode === "local") {
    return runProcess("pct", pctArgs, timeoutMs);
  }

  // SSH to Proxmox host and run pct exec
  const sshArgs = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-p",
    String(settings.sshPort),
    "-i",
    settings.sshPrivateKeyPath,
    `${settings.sshUser}@${settings.sshHost}`,
    "pct",
    ...pctArgs,
  ];

  return runProcess("ssh", sshArgs, timeoutMs);
}

/**
 * Build a bash -lc script that drives community-script `update` non-interactively
 * by feeding predetermined answers (usually "y") on stdin.
 */
export function buildCommunityUpdateScript(answers: string): string {
  const payload = answers.endsWith("\n") ? answers : `${answers}\n`;
  // Prefer `update` on PATH (helper-scripts install this). Fall back to common locations.
  return [
    "set -o pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    "export NEEDRESTART_MODE=a",
    'CMD=""',
    'if command -v update >/dev/null 2>&1; then CMD="update"',
    'elif [ -x /usr/bin/update ]; then CMD="/usr/bin/update"',
    'elif [ -x /usr/local/bin/update ]; then CMD="/usr/local/bin/update"',
    "else echo 'No community-script update command found'; exit 127; fi",
    `printf %s ${shellQuote(payload)} | "$CMD"`,
  ].join("; ");
}

export function buildAptUpdateScript(): string {
  return [
    "export DEBIAN_FRONTEND=noninteractive",
    "export NEEDRESTART_MODE=a",
    "apt-get update -y",
    "apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold dist-upgrade",
    "apt-get -y autoremove --purge",
  ].join(" && ");
}

export function buildApkUpdateScript(): string {
  return "apk update && apk upgrade";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function detectUpdateMethod(
  settings: AppSettings,
  vmid: number,
): Promise<"community-script" | "apt" | "apk" | "unknown"> {
  if (settings.mockMode) {
    return "unknown";
  }

  const detect = await pctExec(
    settings,
    vmid,
    [
      "bash",
      "-lc",
      [
        'if command -v update >/dev/null 2>&1 || [ -x /usr/bin/update ] || [ -x /usr/local/bin/update ]; then echo community-script',
        'elif command -v apt-get >/dev/null 2>&1; then echo apt',
        'elif command -v apk >/dev/null 2>&1; then echo apk',
        "else echo unknown; fi",
      ].join("; "),
    ],
    60,
  );

  const line = detect.stdout.trim().split("\n").pop()?.trim();
  if (
    line === "community-script" ||
    line === "apt" ||
    line === "apk" ||
    line === "unknown"
  ) {
    return line;
  }
  return "unknown";
}
