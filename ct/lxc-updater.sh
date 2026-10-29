#!/usr/bin/env bash
# Community-scripts compatible host entrypoint for LXC Updater.
# Prefer install/proxmox-ve.sh for standalone installs from this repository.
#
# When contributed upstream (or when core build.func is available):
#   bash ct/lxc-updater.sh
#
_CS_DEFAULT_URL="${_CS_DEFAULT_URL:-https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main}"
_cs_boot="${COMMUNITY_SCRIPTS_CORE_DIR:-$(dirname "${BASH_SOURCE[0]}")/../../core}/core/build.func"
# shellcheck disable=SC1090
source "$_cs_boot" 2>/dev/null || source <(curl -fsSL "${COMMUNITY_SCRIPTS_CORE_URL:-https://raw.githubusercontent.com/community-scripts/core/main}/core/build.func")

# Source: this repository

APP="LXC Updater"
var_tags="${var_tags:-proxmox;automation;updater}"
var_cpu="${var_cpu:-2}"
var_ram="${var_ram:-2048}"
var_disk="${var_disk:-8}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_unprivileged="${var_unprivileged:-1}"
var_arm64="${var_arm64:-yes}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources

  if [[ ! -d /opt/lxc-updater ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  NODE_VERSION="22" setup_nodejs

  msg_info "Stopping Service"
  systemctl stop lxc-updater
  msg_ok "Stopped Service"

  msg_info "Backing up Data"
  mkdir -p /opt/lxc-updater-data
  if [[ -d /opt/lxc-updater/data && ! -L /opt/lxc-updater/data ]]; then
    cp -a /opt/lxc-updater/data/. /opt/lxc-updater-data/ 2>/dev/null || true
  fi
  msg_ok "Backed up Data"

  BACKUP_DIR="$(mktemp -d /var/tmp/lxc-updater-backup.XXXXXX)"
  msg_info "Snapshotting app to ${BACKUP_DIR}"
  rsync -a --exclude 'data' /opt/lxc-updater/ "${BACKUP_DIR}/app/"
  msg_ok "Snapshot ready"

  restore_ct_backup() {
    msg_error "Update failed — restoring previous app from backup"
    rsync -a --delete --exclude 'data' "${BACKUP_DIR}/app"/ /opt/lxc-updater/
    rm -rf /opt/lxc-updater/data
    ln -sfn /opt/lxc-updater-data /opt/lxc-updater/data
    systemctl start lxc-updater
    rm -rf "${BACKUP_DIR}"
  }

  if [[ -d /opt/lxc-updater/.git ]]; then
    msg_info "Pulling latest sources"
    cd /opt/lxc-updater
    $STD git fetch --depth 1 origin main || true
    $STD git reset --hard origin/main || $STD git pull --ff-only || true
    msg_ok "Pulled latest sources"
  elif declare -F check_for_gh_release >/dev/null && declare -F fetch_and_deploy_gh_release >/dev/null; then
    if check_for_gh_release "lxc-updater" "${LXC_UPDATER_GH_REPO:-community/proxmox-lxc-updater}"; then
      CLEAN_INSTALL=1 fetch_and_deploy_gh_release "lxc-updater" "${LXC_UPDATER_GH_REPO:-community/proxmox-lxc-updater}" "tarball" "latest" "/opt/lxc-updater"
    fi
  else
    msg_error "Not a git checkout and no GitHub release helper available"
    systemctl start lxc-updater
    rm -rf "${BACKUP_DIR}"
    exit
  fi

  msg_info "Building ${APP}"
  cd /opt/lxc-updater
  # Turbopack cannot build while data/ symlinks outside the app tree.
  rm -rf /opt/lxc-updater/data /opt/lxc-updater/.next
  mkdir -p /opt/lxc-updater/data
  export LXC_UPDATER_DATA_DIR="${LXC_UPDATER_DATA_DIR:-/opt/lxc-updater-data}"
  if ! $STD npm install || ! $STD npm run build; then
    restore_ct_backup
    exit 1
  fi
  mkdir -p /opt/lxc-updater-data
  rm -rf /opt/lxc-updater/data
  ln -sfn /opt/lxc-updater-data /opt/lxc-updater/data
  msg_ok "Built ${APP}"

  msg_info "Starting Service"
  systemctl start lxc-updater
  sleep 2
  if ! systemctl is-active --quiet lxc-updater; then
    restore_ct_backup
    exit 1
  fi
  rm -rf "${BACKUP_DIR}"
  msg_ok "Started Service"
  msg_ok "Updated successfully!"
  exit
}

start
build_container
description

msg_ok "Completed successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW} Access it using the following URL:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:3847${CL}"
echo -e "${INFO}${YW} Turn off Mock mode and add a Proxmox API token + SSH trust in Settings.${CL}"
