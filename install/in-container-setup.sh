#!/usr/bin/env bash
# =============================================================================
# LXC Updater — Debian guest provisioning + application install
# =============================================================================
# Runs INSIDE the LXC. Prepares a complete Debian environment (packages,
# locale, time sync, Node.js runtime, systemd) then builds and starts the app.
# Invoked by install/proxmox-ve.sh via pct exec / pct push.
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lxc-updater}"
DATA_DIR="${DATA_DIR:-/opt/lxc-updater-data}"
APP_PORT="${APP_PORT:-3847}"
REPO_URL="${LXC_UPDATER_REPO:-https://github.com/greir-hull/lxc-update-manager.git}"
REPO_BRANCH="${LXC_UPDATER_BRANCH:-main}"
GH_REPO="${LXC_UPDATER_GH_REPO:-greir-hull/lxc-update-manager}"
NODE_MAJOR="${NODE_MAJOR:-22}"
ENABLE_SSH_SERVER="${ENABLE_SSH_SERVER:-0}"
TZ_NAME="${TZ:-}"

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

msg() { echo -e " \033[1;36m➜\033[0m  $*"; }
ok() { echo -e " \033[1;32m✔\033[0m  $*"; }
warn() { echo -e " \033[1;33m!\033[0m  $*"; }
err() { echo -e " \033[1;31m✖\033[0m  $*" >&2; exit 1; }

if [[ $EUID -ne 0 ]]; then
  err "Run as root inside the container"
fi

# ---------------------------------------------------------------------------
# 1. Network readiness
# ---------------------------------------------------------------------------
msg "Waiting for network"
for i in $(seq 1 60); do
  if getent hosts deb.debian.org >/dev/null 2>&1 \
    || ping -c1 -W1 1.1.1.1 >/dev/null 2>&1 \
    || curl -fsSIL --max-time 3 https://deb.debian.org >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [[ $i -eq 60 ]]; then
    err "No network connectivity inside the container"
  fi
done
ok "Network is up"

# ---------------------------------------------------------------------------
# 2. Base Debian environment (helper-script style)
# ---------------------------------------------------------------------------
msg "Configuring Debian base system"

# Prefer IPv4 for apt when dual-stack is flaky (common in LXCs)
if [[ ! -f /etc/apt/apt.conf.d/99force-ipv4 ]]; then
  cat >/etc/apt/apt.conf.d/99force-ipv4 <<'EOF'
Acquire::ForceIPv4 "true";
EOF
fi

# Quiet noisy needrestart prompts during unattended installs
mkdir -p /etc/needrestart/conf.d
cat >/etc/needrestart/conf.d/lxc-updater.conf <<'EOF' 2>/dev/null || true
$nrconf{restart} = 'a';
EOF

apt-get update -y
apt-get -y -o Dpkg::Options::="--force-confdef" \
  -o Dpkg::Options::="--force-confold" dist-upgrade

msg "Installing base packages"
apt-get install -y --no-install-recommends \
  apt-transport-https \
  ca-certificates \
  curl \
  wget \
  gnupg \
  sudo \
  git \
  jq \
  rsync \
  openssh-client \
  python3 \
  locales \
  tzdata \
  chrony \
  dbus \
  systemd-sysv \
  build-essential \
  gcc \
  g++ \
  make \
  pkg-config \
  libssl-dev \
  unzip \
  nano \
  vim-tiny \
  htop \
  iproute2 \
  iputils-ping \
  dnsutils \
  procps \
  cron

if [[ "$ENABLE_SSH_SERVER" == "1" ]]; then
  apt-get install -y --no-install-recommends openssh-server
  systemctl enable -q --now ssh.service || systemctl enable -q --now sshd.service || true
  ok "OpenSSH server enabled"
fi
ok "Base packages installed"

# Locale
msg "Configuring locale (en_US.UTF-8)"
if ! locale -a 2>/dev/null | grep -qi 'en_US.utf8\|en_US.UTF-8'; then
  sed -i 's/^# *en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen 2>/dev/null || true
  if ! grep -q '^en_US.UTF-8 UTF-8' /etc/locale.gen 2>/dev/null; then
    echo 'en_US.UTF-8 UTF-8' >>/etc/locale.gen
  fi
  locale-gen en_US.UTF-8 >/dev/null
fi
update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 >/dev/null 2>&1 || true
cat >/etc/default/locale <<'EOF'
LANG=en_US.UTF-8
LC_ALL=en_US.UTF-8
EOF
ok "Locale ready"

# Timezone — inherit from host via container config when possible
msg "Configuring timezone"
if [[ -n "$TZ_NAME" && -f "/usr/share/zoneinfo/$TZ_NAME" ]]; then
  timedatectl set-timezone "$TZ_NAME" 2>/dev/null \
    || ln -sfn "/usr/share/zoneinfo/$TZ_NAME" /etc/localtime
elif [[ -L /etc/localtime ]]; then
  :
else
  timedatectl set-timezone UTC 2>/dev/null || ln -sfn /usr/share/zoneinfo/UTC /etc/localtime
fi
systemctl enable -q --now chrony.service 2>/dev/null \
  || systemctl enable -q --now chronyd.service 2>/dev/null \
  || true
ok "Timezone / time sync configured"

# Ensure systemd is the init we expect and journald is usable
mkdir -p /var/log/journal
systemd-tmpfiles --create >/dev/null 2>&1 || true

# Soften motd noise; add a clear app banner
msg "Writing MOTD"
cat >/etc/motd <<EOF

  LXC Updater
  -----------
  Web UI  : http://<this-ct-ip>:${APP_PORT}
  Service : systemctl status lxc-updater
  Update  : type  update  in this console
  Password: lxc-updater-passwd   (or: lxc-updater-passwd --reset)
  App     : /opt/lxc-updater
  Data    : /opt/lxc-updater-data

EOF
# Disable default Debian motd scripts that spam on login (keep ours)
chmod -x /etc/update-motd.d/* 2>/dev/null || true
ok "MOTD configured"

# ---------------------------------------------------------------------------
# 3. Node.js runtime
# ---------------------------------------------------------------------------
msg "Installing Node.js ${NODE_MAJOR}"
if command -v node >/dev/null 2>&1; then
  CURRENT_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
else
  CURRENT_MAJOR=0
fi

if [[ "$CURRENT_MAJOR" -lt "$NODE_MAJOR" ]]; then
  # NodeSource repository (Debian)
  apt-get install -y --no-install-recommends ca-certificates curl gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    >/etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi

command -v node >/dev/null || err "Node.js installation failed"
command -v npm >/dev/null || err "npm missing after Node.js install"
ok "Node $(node -v) / npm $(npm -v)"

# ---------------------------------------------------------------------------
# 4. Application source
# ---------------------------------------------------------------------------
mkdir -p "$APP_DIR" "$DATA_DIR"
cd "$APP_DIR"

if [[ -f "$APP_DIR/package.json" ]]; then
  msg "Application source already present in ${APP_DIR}"
elif [[ -n "$REPO_URL" ]]; then
  msg "Cloning ${REPO_URL} (${REPO_BRANCH})"
  rm -rf "${APP_DIR:?}/"* "${APP_DIR}"/.[!.]* "${APP_DIR}"/..?* 2>/dev/null || true
  git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
else
  err "No application source found. Set LXC_UPDATER_REPO or copy the project into ${APP_DIR} first."
fi

# Record public source so /usr/bin/update can refresh without a full reinstall
# even when the tree was copied from the embedded installer (no .git).
mkdir -p "$APP_DIR"
cat >"$APP_DIR/.lxc-updater-source" <<EOF
LXC_UPDATER_GH_REPO=${GH_REPO}
LXC_UPDATER_REPO=${REPO_URL}
LXC_UPDATER_BRANCH=${REPO_BRANCH}
EOF

# ---------------------------------------------------------------------------
# 5. Build & persist data outside the app tree
# ---------------------------------------------------------------------------
msg "Installing npm packages and building production bundle"
cd "$APP_DIR"
# Turbopack panics if data/ is a symlink that leaves the app tree (e.g. to
# /opt/lxc-updater-data). Build against a real directory, then re-link.
if [[ -L "$APP_DIR/data" ]]; then
  rm -f "$APP_DIR/data"
fi
mkdir -p "$APP_DIR/data"
# Full install so Next.js can compile (typescript / tailwind are needed at build)
npm install
npm run build
ok "Built LXC Updater"

mkdir -p "$DATA_DIR"
if [[ -f "$APP_DIR/data/state.json" && ! -L "$APP_DIR/data" && ! -f "$DATA_DIR/state.json" ]]; then
  mv "$APP_DIR/data/state.json" "$DATA_DIR/"
fi
rm -rf "$APP_DIR/data"
ln -sfn "$DATA_DIR" "$APP_DIR/data"

# ---------------------------------------------------------------------------
# 6. systemd unit
# ---------------------------------------------------------------------------
msg "Creating and enabling lxc-updater.service"
cat >/etc/systemd/system/lxc-updater.service <<EOF
[Unit]
Description=Proxmox LXC Updater
Documentation=file://${APP_DIR}/README.md
After=network-online.target chrony.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}
Environment=LXC_UPDATER_DATA_DIR=${DATA_DIR}
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5
TimeoutStartSec=120

# Hardening (safe for a dedicated updater CT)
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable -q lxc-updater.service
systemctl restart lxc-updater.service

# Wait briefly for the service to come up
for i in $(seq 1 20); do
  if systemctl is-active --quiet lxc-updater.service; then
    break
  fi
  sleep 1
done
if systemctl is-active --quiet lxc-updater.service; then
  ok "Service lxc-updater is active"
else
  warn "Service did not report active yet — check: journalctl -u lxc-updater -e"
  systemctl --no-pager --full status lxc-updater.service || true
fi

# ---------------------------------------------------------------------------
# 7. Helper-script style /usr/bin/update (backup + rollback on failure)
# ---------------------------------------------------------------------------
msg "Installing /usr/bin/update"
UPDATE_SRC="${APP_DIR}/scripts/lxc-updater-update.sh"
if [[ -f "$UPDATE_SRC" ]]; then
  # Bake this install's repo defaults into the shipped script copy.
  sed -e "s|^DEFAULT_GH_REPO=.*|DEFAULT_GH_REPO=\"${GH_REPO}\"|" \
      -e "s|^DEFAULT_REPO_URL=.*|DEFAULT_REPO_URL=\"${REPO_URL}\"|" \
      -e "s|^DEFAULT_BRANCH=.*|DEFAULT_BRANCH=\"${REPO_BRANCH}\"|" \
      "$UPDATE_SRC" >/usr/bin/update
  chmod +x /usr/bin/update
  chmod +x "$UPDATE_SRC" || true
  ok "Installed update command (temp backup + auto-rollback on failure)"
else
  warn "scripts/lxc-updater-update.sh missing — writing minimal update stub"
  cat >/usr/bin/update <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "Update script missing. Re-run the LXC Updater installer." >&2
exit 1
EOF
  chmod +x /usr/bin/update
fi

# ---------------------------------------------------------------------------
# 7b. Web UI password CLI (set / recover without the browser)
# ---------------------------------------------------------------------------
msg "Installing /usr/bin/lxc-updater-passwd"
PASSWD_SRC="${APP_DIR}/scripts/lxc-updater-passwd.mjs"
if [[ -f "$PASSWD_SRC" ]]; then
  cat >/usr/bin/lxc-updater-passwd <<EOF
#!/usr/bin/env bash
set -euo pipefail
export LXC_UPDATER_DATA_DIR="\${LXC_UPDATER_DATA_DIR:-/opt/lxc-updater-data}"
exec node "${APP_DIR}/scripts/lxc-updater-passwd.mjs" "\$@"
EOF
  chmod +x /usr/bin/lxc-updater-passwd
  chmod +x "$PASSWD_SRC" || true
  ok "Installed lxc-updater-passwd"
else
  warn "scripts/lxc-updater-passwd.mjs missing — skip password CLI"
fi

# ---------------------------------------------------------------------------
# 8. SSH client key for pct exec back to the Proxmox host
# ---------------------------------------------------------------------------
if [[ ! -f /root/.ssh/id_ed25519 ]]; then
  msg "Generating SSH key for Proxmox host pct exec"
  mkdir -p /root/.ssh
  chmod 700 /root/.ssh
  ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519 -C "lxc-updater@$(hostname -s)"
  ok "SSH key created at /root/.ssh/id_ed25519.pub"
fi

# ---------------------------------------------------------------------------
# 9. First-run settings defaults
# ---------------------------------------------------------------------------
python3 - <<'PY' || true
import json, pathlib
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
  "auth": {
    "passwordHash": None,
    "passwordSalt": None,
    "sessionSecret": None,
    "passwordSetAt": None,
  },
  "automations": [],
  "jobs": [],
  "apiKeys": [],
  "containerMeta": {},
  "nodeMeta": {},
}
path.write_text(json.dumps(state, indent=2))
PY

# ---------------------------------------------------------------------------
# 10. Cleanup (community-scripts style)
# ---------------------------------------------------------------------------
msg "Cleaning up apt caches"
apt-get autoremove -y >/dev/null 2>&1 || true
apt-get autoclean -y >/dev/null 2>&1 || true
rm -rf /var/lib/apt/lists/*
mkdir -p /var/lib/apt/lists/partial
ok "Cleanup done"

ok "Debian environment + LXC Updater are ready"
echo
echo "  Service : lxc-updater.service"
echo "  App dir : ${APP_DIR}"
echo "  Data    : ${DATA_DIR}"
echo "  Port    : ${APP_PORT}"
echo "  Update  : type 'update' in this CT console"
echo "  Password: open the UI to set one, or run: lxc-updater-passwd"
echo

