# LXC Updater

Web UI that runs in a Proxmox LXC and manages updates for other containers on the node — including ones installed with [Proxmox VE Helper-Scripts](https://github.com/community-scripts/ProxmoxVE) that normally require typing `update` in the CT console and answering prompts.

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

## Deploy in a Proxmox LXC

1. Create a Debian/Ubuntu LXC (CT) with Nesting enabled if you plan to use Docker later; not required for this app.
2. Install Node.js 22+, then clone this repo into the CT.
3. Create a Proxmox API token (Datacenter → Permissions → API Tokens) with permission to list LXC resources.
4. Give this CT SSH access to the Proxmox host as a user that can run `pct` (typically `root`), **or** use local `pct` from a privileged CT with host tools available.
5. Configure and run:

```bash
npm install
npm run build
npm run start
```

Or with a process manager:

```bash
# example: systemd user unit pointing at `npm run start`
```

In the UI → **Settings**:

| Setting | Typical value |
| --- | --- |
| Mock mode | Off |
| Proxmox host / port | Your node IP, `8006` |
| API token ID / secret | `user@pam!token-name` + secret |
| Exec mode | `SSH to Proxmox host → pct exec` |
| SSH host / key path | Same node, key mounted in this CT |

Data (settings, jobs, automations) is stored under `data/state.json`.

### Environment

| Variable | Purpose |
| --- | --- |
| `PORT` | Listen port (default `3847` via npm scripts) |
| `LXC_UPDATER_DATA_DIR` | Override data directory |

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
