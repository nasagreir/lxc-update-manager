#!/usr/bin/env bash
# In-container setup for LXC Updater.
# Called by the host installer (pct exec) or by community-scripts install wrapper.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lxc-updater}"
APP_PORT="${APP_PORT:-3847}"
REPO_URL="${LXC_UPDATER_REPO:-}"
REPO_BRANCH="${LXC_UPDATER_BRANCH:-main}"
NODE_MAJOR="${NODE_MAJOR:-22}"

export DEBIAN_FRONTEND=noninteractive

msg() { echo -e " \033[1;36m➜\033[0m  $*"; }
ok() { echo -e " \033[1;32m✔\033[0m  $*"; }
err() { echo -e " \033[1;31m✖\033[0m  $*" >&2; exit 1; }

msg "Updating OS packages"
apt-get update -y
apt-get -y dist-upgrade
apt-get install -y \
  curl \
  ca-certificates \
  gnupg \
  git \
  openssh-client \
  jq \
  rsync \
  build-essential
ok "Dependencies installed"

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)" -lt "$NODE_MAJOR" ]]; then
  msg "Installing Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
ok "Node $(node -v) / npm $(npm -v)"

mkdir -p "$APP_DIR" /opt/lxc-updater-data
cd "$APP_DIR"

if [[ -f "$APP_DIR/package.json" ]]; then
  msg "Application files already present in ${APP_DIR}"
elif [[ -n "$REPO_URL" ]]; then
  msg "Cloning ${REPO_URL} (${REPO_BRANCH})"
  rm -rf "${APP_DIR:?}/"* "${APP_DIR}"/.[!.]* 2>/dev/null || true
  git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
else
  err "No application source found. Set LXC_UPDATER_REPO or copy the project into ${APP_DIR} first."
fi

msg "Installing npm packages and building"
npm install --omit=dev
# Dev deps needed for next build (typescript, tailwind, etc.)
npm install
npm run build
ok "Built LXC Updater"

mkdir -p "$APP_DIR/data"
# Prefer persistent data outside the app tree so updates can replace /opt/lxc-updater
if [[ -d /opt/lxc-updater-data ]]; then
  if [[ -f "$APP_DIR/data/state.json" && ! -f /opt/lxc-updater-data/state.json ]]; then
    mv "$APP_DIR/data/state.json" /opt/lxc-updater-data/
  fi
  rm -rf "$APP_DIR/data"
  ln -sfn /opt/lxc-updater-data "$APP_DIR/data"
fi

msg "Creating systemd service"
cat >/etc/systemd/system/lxc-updater.service <<EOF
[Unit]
Description=Proxmox LXC Updater
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}
Environment=LXC_UPDATER_DATA_DIR=/opt/lxc-updater-data
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable -q --now lxc-updater.service
ok "Service lxc-updater enabled"

msg "Installing /usr/bin/update (helper-script style)"
cat >/usr/bin/update <<'UPDATE'
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="/opt/lxc-updater"
DATA_DIR="/opt/lxc-updater-data"
BRANCH="${LXC_UPDATER_BRANCH:-main}"

header() {
  clear
  cat <<'EOF'
    __   _  __ ______   __  __          __      __
   / /  | |/ // ____/  / / / /___  ____/ /___ _/ /____  _____
  / /   |   // /      / / / / __ \/ __  / __ `/ __/ _ \/ ___/
 / /___/   |/ /___   / /_/ / /_/ / /_/ / /_/ / /_/  __/ /
/_____/_/|_|\____/   \____/ .___/\__,_/\__,_/\__/\___/_/
                         /_/
EOF
  echo "  LXC Updater maintenance"
  echo
}

ask_yes() {
  local prompt="${1:-Continue?}"
  read -r -p "$prompt [y/N] " ans
  [[ "${ans,,}" == "y" || "${ans,,}" == "yes" ]]
}

header
if [[ ! -d "$APP_DIR/.git" && ! -f "$APP_DIR/package.json" ]]; then
  echo "No LXC Updater installation found in $APP_DIR"
  exit 1
fi

echo "This will pull the latest code, rebuild, and restart the service."
echo "App data in $DATA_DIR is preserved."
echo
if ! ask_yes "Proceed with update?"; then
  echo "Aborted."
  exit 0
fi

systemctl stop lxc-updater.service || true

if [[ -d "$APP_DIR/.git" ]]; then
  cd "$APP_DIR"
  git fetch --depth 1 origin "$BRANCH" || git fetch --depth 1 origin
  git reset --hard "origin/${BRANCH}" 2>/dev/null || git pull --ff-only || true
else
  echo "Not a git checkout — skipping git pull. Replace $APP_DIR manually if needed."
fi

cd "$APP_DIR"
npm install
npm run build

# Keep data symlink
mkdir -p "$DATA_DIR"
rm -rf "$APP_DIR/data"
ln -sfn "$DATA_DIR" "$APP_DIR/data"

systemctl start lxc-updater.service
echo
echo "Update complete. Service status:"
systemctl --no-pager --full status lxc-updater.service || true
UPDATE
chmod +x /usr/bin/update
ok "Installed update command"

if [[ ! -f /root/.ssh/id_ed25519 ]]; then
  msg "Generating SSH key for Proxmox host pct exec"
  mkdir -p /root/.ssh
  chmod 700 /root/.ssh
  ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519 -C "lxc-updater@$(hostname -s)"
  ok "SSH key created at /root/.ssh/id_ed25519"
fi

# Sensible defaults baked into first-run settings (mockMode stays true until configured)
python3 - <<'PY' || true
import json, os, pathlib
path = pathlib.Path("/opt/lxc-updater-data/state.json")
if path.exists():
    raise SystemExit(0)
path.parent.mkdir(parents=True, exist_ok=True)
state = {
  "settings": {
    "mockMode": True,
    "proxmoxHost": "192.168.1.10",
    "proxmoxPort": 8006,
    "proxmoxVerifyTls": False,
    "apiTokenId": "root@pam!lxc-updater",
    "apiTokenSecret": "",
    "defaultNode": "",
    "execMode": "ssh",
    "sshHost": "192.168.1.10",
    "sshPort": 22,
    "sshUser": "root",
    "sshPrivateKeyPath": "/root/.ssh/id_ed25519",
    "updateTimeoutSeconds": 1800,
    "communityScriptAnswers": "y\ny\ny\ny\ny\ny\ny\ny\n",
  },
  "automations": [],
  "jobs": [],
  "containerMeta": {},
}
path.write_text(json.dumps(state, indent=2))
PY

apt-get autoremove -y >/dev/null 2>&1 || true
apt-get autoclean >/dev/null 2>&1 || true

ok "LXC Updater is installed"
echo
echo "  Service : lxc-updater.service"
echo "  App dir : ${APP_DIR}"
echo "  Data    : /opt/lxc-updater-data"
echo "  Port    : ${APP_PORT}"
echo "  Update  : type 'update' in this CT console"
echo
