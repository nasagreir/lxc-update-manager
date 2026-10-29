#!/usr/bin/env node
/**
 * After a successful production build on the updater CT, refresh /usr/bin/update
 * from the app tree so the next `update` run includes backup/rollback logic.
 * No-op when not root or when the script is missing (dev machines).
 */
import { chmodSync, copyFileSync, existsSync } from "fs";
import { join } from "path";

const uid = typeof process.getuid === "function" ? process.getuid() : -1;
if (uid !== 0) process.exit(0);

const appDir = process.env.APP_DIR || process.cwd();
const src = join(appDir, "scripts/lxc-updater-update.sh");
const dest = "/usr/bin/update";

if (!existsSync(src)) process.exit(0);

try {
  copyFileSync(src, dest);
  chmodSync(dest, 0o755);
  console.log(`Updated ${dest} from ${src}`);
} catch (err) {
  console.warn(
    `Could not refresh ${dest}:`,
    err instanceof Error ? err.message : err,
  );
}
