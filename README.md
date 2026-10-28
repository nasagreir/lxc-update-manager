# LXC Updater

Web UI that runs in a Proxmox LXC and manages updates for other containers on the node — including ones installed with [Proxmox VE Helper-Scripts](https://github.com/community-scripts/ProxmoxVE) that normally require typing `update` in the CT console and answering prompts.

## Install on Proxmox (helper-script style)

Run this **on the Proxmox host shell** (Datacenter → node → Shell), not inside a guest.

### From a checkout on the host

```bash
git clone <this-repo-url> proxmox-lxc-updater
cd proxmox-lxc-updater
bash install/proxmox-ve.sh
```

### One-liner (after the repo is published somewhere curlable)

```bash
bash -c "$(curl -fsSL https://RAW_URL_TO/install/proxmox-ve.sh)"
```

When installing via curl (no local tree), set the git source:

```bash
export LXC_UPDATER_REPO="https://github.com/YOU/proxmox-lxc-updater.git"
bash -c "$(curl -fsSL https://RAW_URL_TO/install/proxmox-ve.sh)"
```

The installer will:

1. Prompt for **Default** or **Advanced** settings (CTID, storage, CPU/RAM/disk, bridge, IP)
2. Create a Debian LXC and start it
3. Install Node.js 22, build the app into `/opt/lxc-updater`, enable `lxc-updater.service`
4. Install a console **`update`** command (same UX as community helper scripts)
5. Generate an SSH key in the CT and optionally authorize it on the host for `pct exec`

Then open `http://<CT-IP>:3847`, turn off Mock mode, and add your Proxmox API token.

| Env var | Purpose |
| --- | --- |
| `LXC_UPDATER_REPO` | Git URL cloned into the CT when not installing from a local checkout |
| `LXC_UPDATER_BRANCH` | Branch to clone (default `main`) |
| `APP_PORT` | Web UI port (default `3847`) |
| `CTID` / `HN` / `STORAGE` / … | Non-interactive overrides for Advanced defaults |

### Community-scripts layout

This repo also ships the usual pair for upstream-style installs:

| Path | Role |
| --- | --- |
| `ct/lxc-updater.sh` | Host entry (sources `build.func`, `build_container`) |
| `install/lxc-updater-install.sh` | Runs inside the new CT via the helper-scripts framework |
| `install/in-container-setup.sh` | Shared bare-metal setup used by the standalone installer |
| `install/proxmox-ve.sh` | **Recommended** self-contained host installer |

## What it does

- Lists all LXC containers via the Proxmox API
- Detects how each CT updates: community `update` command, `apt`, or `apk`
- Runs updates from the browser (with live job logs)
- Schedules automations (daily / weekly / monthly / cron) that drive the same path unattended

Community-script updates work by piping configurable answers (usually `y`) into `update` over `pct exec`, so you do not need an interactive console.

## Quick start (development)

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847). **Mock mode is on by default** — sample containers and simulated updates, no Proxmox required.

## Manual deploy (without the installer)

1. Create a Debian LXC, install Node.js 22+
2. Copy this repo to `/opt/lxc-updater` and run `install/in-container-setup.sh`
3. Or: `npm install && npm run build && systemctl enable --now` using `deploy/lxc-updater.service`
4. Create a Proxmox API token and SSH trust from the CT to the host (user that can run `pct`)

In the UI → **Settings**:

| Setting | Typical value |
| --- | --- |
| Mock mode | Off |
| Proxmox host / port | Your node IP, `8006` |
| API token ID / secret | `user@pam!token-name` + secret |
| Exec mode | `SSH to Proxmox host → pct exec` |
| SSH host / key path | Same node, `/root/.ssh/id_ed25519` |

Data persists under `/opt/lxc-updater-data` (symlink from `data/`).

### Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port when overriding npm scripts |
| `LXC_UPDATER_DATA_DIR` | Override data directory |

## Updating the updater CT

Inside the LXC console:

```bash
update
```

Follow the prompts (same pattern as other helper-script containers).

## How community-script updates work

Helper-script CTs expose an `update` command that is interactive. LXC Updater runs roughly:

```bash
pct exec <vmid> -- bash -lc 'printf "y\ny\n…" | update'
```

Answers are editable in Settings. Plain Debian/Alpine CTs without `update` fall back to `apt` / `apk` upgrades.

## Security notes

- Treat the API token and SSH key as root-equivalent for container management.
- Bind the UI to a trusted network or put it behind SSO / reverse proxy.
- Automations can upgrade many CTs — start with a small selected set.

## Stack

Next.js (App Router), TypeScript, Tailwind, shadcn/ui, file-backed JSON store, `node-cron` for schedules.
