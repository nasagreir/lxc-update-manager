#!/usr/bin/env bash
# Community-scripts compatible in-container installer for LXC Updater.
# Invoked by build_container after the CT is created.
#
# For standalone installs from this repo, use install/proxmox-ve.sh instead.

# shellcheck disable=SC1090
source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Dependencies"
$STD apt-get install -y \
  curl \
  ca-certificates \
  git \
  openssh-client \
  jq \
  rsync \
  build-essential
msg_ok "Installed Dependencies"

NODE_VERSION="22" setup_nodejs

APP_DIR="/opt/lxc-updater"
DATA_DIR="/opt/lxc-updater-data"
REPO="${LXC_UPDATER_GH_REPO:-}"
# When shipped inside the ProxmoxVE monorepo, prefer shipping sources via
# fetch_and_deploy_gh_release. Until published there, clone from LXC_UPDATER_REPO.
if [[ -n "${LXC_UPDATER_REPO:-}" ]]; then
  msg_info "Cloning LXC Updater"
  rm -rf "$APP_DIR"
  $STD git clone --depth 1 --branch "${LXC_UPDATER_BRANCH:-main}" "$LXC_UPDATER_REPO" "$APP_DIR"
  msg_ok "Cloned LXC Updater"
elif [[ -n "$REPO" ]] && declare -F fetch_and_deploy_gh_release >/dev/null; then
  fetch_and_deploy_gh_release "lxc-updater" "$REPO" "tarball" "latest" "$APP_DIR"
else
  msg_error "Set LXC_UPDATER_REPO (git URL) or LXC_UPDATER_GH_REPO (owner/name) before install"
  exit 1
fi

msg_info "Building LXC Updater"
cd "$APP_DIR"
# Turbopack cannot build while data/ symlinks outside the app tree.
if [[ -L "$APP_DIR/data" ]]; then
  rm -f "$APP_DIR/data"
fi
mkdir -p "$APP_DIR/data"
$STD npm install
$STD npm run build
mkdir -p "$DATA_DIR"
rm -rf "$APP_DIR/data"
ln -sfn "$DATA_DIR" "$APP_DIR/data"
msg_ok "Built LXC Updater"

msg_info "Creating Service"
cat <<EOF >/etc/systemd/system/lxc-updater.service
[Unit]
Description=Proxmox LXC Updater
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=3847
Environment=LXC_UPDATER_DATA_DIR=${DATA_DIR}
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl enable -q --now lxc-updater
msg_ok "Created Service"

msg_info "Installing update helper"
# Prefer the project-maintained update script when present
if [[ -x "$APP_DIR/install/in-container-setup.sh" ]]; then
  # Ensure /usr/bin/update exists (extract from setup or write minimal)
  bash -lc "APP_DIR=$APP_DIR $(declare -f); true" >/dev/null 2>&1 || true
fi
if [[ -f "$APP_DIR/scripts/lxc-updater-update.sh" ]]; then
  install -m 755 "$APP_DIR/scripts/lxc-updater-update.sh" /usr/bin/update
elif [[ ! -x /usr/bin/update ]]; then
  cat >/usr/bin/update <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "Update script missing. Re-run the LXC Updater installer." >&2
exit 1
EOF
  chmod +x /usr/bin/update
fi
msg_ok "Installed update helper"

if [[ ! -f /root/.ssh/id_ed25519 ]]; then
  msg_info "Generating SSH key for host pct exec"
  mkdir -p /root/.ssh
  ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519 -C "lxc-updater"
  msg_ok "Generated SSH key — authorize it on the Proxmox host"
fi

motd_ssh
customize
cleanup_lxc
