#!/usr/bin/env bash
# =============================================================================
# LXC Updater — Proxmox VE installer (helper-script style)
# =============================================================================
# Run on the Proxmox host shell (node):
#
#   bash -c "$(curl -fsSL https://RAW_URL/install/proxmox-ve.sh)"
#
# Or from a local checkout of this repo on the host:
#
#   bash install/proxmox-ve.sh
#
# Optional env:
#   LXC_UPDATER_REPO     Git URL to clone into the CT (required for curl|bash
#                        unless you run from a full checkout)
#   LXC_UPDATER_BRANCH   Git branch (default: main)
#   APP_PORT             Web UI port (default: 3847)
#   CTID / HN / STORAGE / BRIDGE / CORE / RAM / DISK / NET / PASSWORD overrides
# =============================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "This script must be run as root on a Proxmox VE host." >&2
  exit 1
fi

if ! command -v pct >/dev/null 2>&1; then
  echo "pct not found — run this on the Proxmox VE host, not inside a guest." >&2
  exit 1
fi

# --- colors / helpers (community-scripts inspired) ---------------------------
YW=$(echo "\033[33m")
BL=$(echo "\033[36m")
GN=$(echo "\033[1;92m")
RD=$(echo "\033[01;31m")
CL=$(echo "\033[m")
BOLD=$(echo "\033[1m")
TAB="  "
CM="${GN}✔${CL}"
CROSS="${RD}✖${CL}"
INFO="${BOLD}${BL}ℹ${CL}"
HOLD="-"

msg_info() { echo -e " ${HOLD} ${YW}$1${CL}"; }
msg_ok() { echo -e " ${CM} ${GN}$1${CL}"; }
msg_error() { echo -e " ${CROSS} ${RD}$1${CL}"; }
header_info() {
  clear
  cat <<"EOF"
    __   _  __ ______   __  __          __      __
   / /  | |/ // ____/  / / / /___  ____/ /___ _/ /____  _____
  / /   |   // /      / / / / __ \/ __  / __ `/ __/ _ \/ ___/
 / /___/   |/ /___   / /_/ / /_/ / /_/ / /_/ / /_/  __/ /
/_____/_/|_|\____/   \____/ .___/\__,_/\__,_/\__/\___/_/
                         /_/
EOF
  echo -e "${BOLD}  Proxmox LXC Updater installer${CL}"
  echo
}

# --- resolve script / repo source -------------------------------------------
SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
if [[ "$SCRIPT_SOURCE" != /* ]]; then
  SCRIPT_SOURCE="$(pwd)/$SCRIPT_SOURCE"
fi
# When piped from curl, BASH_SOURCE may be /dev/fd/...
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" 2>/dev/null && pwd || true)"
REPO_ROOT=""
if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/in-container-setup.sh" ]]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
elif [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/../package.json" ]]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

DEFAULT_REPO=""
if [[ -n "$REPO_ROOT" ]] && git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  DEFAULT_REPO="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null | sed -E 's#https://[^@]+@#https://#' || true)"
fi

REPO_URL="${LXC_UPDATER_REPO:-$DEFAULT_REPO}"
REPO_BRANCH="${LXC_UPDATER_BRANCH:-main}"
APP_PORT="${APP_PORT:-3847}"
APP="LXC Updater"
OS_TYPE="debian"
OS_VERSION="13"
TEMPLATE_NAME=""

# --- defaults (overridable) -------------------------------------------------
NEXTID=$(pvesh get /cluster/nextid 2>/dev/null || echo 200)
CTID="${CTID:-$NEXTID}"
HN="${HN:-lxc-updater}"
CORE="${CORE:-2}"
RAM="${RAM:-2048}"
DISK="${DISK:-8}"
BRIDGE="${BRIDGE:-vmbr0}"
NET="${NET:-dhcp}"
STORAGE="${STORAGE:-}"
PASSWORD="${PASSWORD:-}"
SSH_PUBLISH="${SSH_PUBLISH:-1}"
UNPRIVILEGED="${UNPRIVILEGED:-1}"
ENABLE_SSH_SERVER="${ENABLE_SSH_SERVER:-0}"
FEATURES="keyctl=1,nesting=1"

header_info

echo -e "${INFO} This installer will:"
echo -e "${TAB}• create a Debian LXC from the official template"
echo -e "${TAB}• fully provision the guest OS (packages, locale, time sync, Node.js 22)"
echo -e "${TAB}• build ${APP}, enable systemd, and install the console ${BL}update${CL} command"
echo -e "${INFO} Afterwards you can manage other helper-script CTs from the web UI."
echo

# --- mode selection ---------------------------------------------------------
if [[ -z "${INSTALL_MODE:-}" ]]; then
  echo -e " ${BOLD}Installation mode${CL}"
  echo -e "  1) Default   — recommended settings, few prompts"
  echo -e "  2) Advanced  — choose CTID, storage, resources, network"
  echo
  read -r -p "Select [1/2] (default 1): " mode_choice
  case "${mode_choice:-1}" in
    2|a|A|advanced|Advanced) INSTALL_MODE="advanced" ;;
    *) INSTALL_MODE="default" ;;
  esac
fi

pick_storage() {
  local storages
  storages="$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 {print $1}')"
  if [[ -z "$storages" ]]; then
    msg_error "No storage with rootdir content found"
    exit 1
  fi
  if [[ -n "$STORAGE" ]]; then
    return
  fi
  # Prefer local-lvm then first available
  if echo "$storages" | grep -qx "local-lvm"; then
    STORAGE="local-lvm"
    return
  fi
  STORAGE="$(echo "$storages" | head -n1)"
}

prompt_advanced() {
  read -r -p "CTID [${CTID}]: " input && CTID="${input:-$CTID}"
  if pct status "$CTID" &>/dev/null; then
    msg_error "CT ${CTID} already exists"
    exit 1
  fi
  read -r -p "Hostname [${HN}]: " input && HN="${input:-$HN}"
  pick_storage
  echo "Available storages:"
  pvesm status -content rootdir | awk 'NR==1 || NR>1 {print "  "$0}'
  read -r -p "Storage [${STORAGE}]: " input && STORAGE="${input:-$STORAGE}"
  read -r -p "Disk size GB [${DISK}]: " input && DISK="${input:-$DISK}"
  read -r -p "CPU cores [${CORE}]: " input && CORE="${input:-$CORE}"
  read -r -p "RAM MB [${RAM}]: " input && RAM="${input:-$RAM}"
  read -r -p "Bridge [${BRIDGE}]: " input && BRIDGE="${input:-$BRIDGE}"
  read -r -p "IP (dhcp or cidr) [${NET}]: " input && NET="${input:-$NET}"
  read -r -p "Root password (empty = none / key-only): " -s PASSWORD
  echo
  read -r -p "Unprivileged container? [Y/n]: " input
  case "${input:-Y}" in
    n|N|no|No) UNPRIVILEGED=0 ;;
    *) UNPRIVILEGED=1 ;;
  esac
  read -r -p "Web UI port [${APP_PORT}]: " input && APP_PORT="${input:-$APP_PORT}"
  read -r -p "Install OpenSSH server inside the CT? [y/N]: " input
  case "${input:-N}" in
    y|Y|yes|Yes) ENABLE_SSH_SERVER=1 ;;
    *) ENABLE_SSH_SERVER=0 ;;
  esac
}

if [[ "$INSTALL_MODE" == "advanced" ]]; then
  prompt_advanced
else
  pick_storage
  if pct status "$CTID" &>/dev/null; then
    msg_error "Suggested CTID ${CTID} already exists — re-run in Advanced mode"
    exit 1
  fi
fi

if [[ -z "$REPO_URL" && -z "$REPO_ROOT" ]]; then
  echo
  msg_info "No local checkout detected and LXC_UPDATER_REPO is unset."
  read -r -p "Git repository URL to install from: " REPO_URL
  if [[ -z "$REPO_URL" ]]; then
    msg_error "A repository URL is required"
    exit 1
  fi
fi

echo
msg_info "Plan"
echo -e "${TAB}CTID      : ${BL}${CTID}${CL}"
echo -e "${TAB}Hostname  : ${BL}${HN}${CL}"
echo -e "${TAB}Storage   : ${BL}${STORAGE}${CL}"
echo -e "${TAB}Resources : ${BL}${CORE} CPU / ${RAM} MB / ${DISK} GB${CL}"
echo -e "${TAB}Network   : ${BL}${BRIDGE} / ${NET}${CL}"
echo -e "${TAB}Port      : ${BL}${APP_PORT}${CL}"
echo -e "${TAB}Guest OS  : ${BL}Debian ${OS_VERSION}${CL} (apt upgrade, locale, chrony, Node 22, systemd)"
SSH_SERVER_LABEL="no (client only)"
[[ "$ENABLE_SSH_SERVER" == "1" ]] && SSH_SERVER_LABEL="yes"
echo -e "${TAB}SSH server: ${BL}${SSH_SERVER_LABEL}${CL}"
if [[ -n "$REPO_ROOT" && -z "${LXC_UPDATER_REPO:-}" ]]; then
  echo -e "${TAB}Source    : ${BL}local checkout ${REPO_ROOT}${CL}"
else
  echo -e "${TAB}Source    : ${BL}${REPO_URL:-local} (${REPO_BRANCH})${CL}"
fi
echo
read -r -p "Proceed? [Y/n]: " confirm
case "${confirm:-Y}" in
  n|N|no|No) echo "Aborted."; exit 0 ;;
esac

# --- template ---------------------------------------------------------------
msg_info "Refreshing template list"
pveam update >/dev/null || true

TEMPLATE_NAME="$(pveam available -section system | awk -v ver="$OS_VERSION" '
  $0 ~ /debian-/ && $0 ~ ver && $0 ~ /standard/ {print $2; exit}
')"
if [[ -z "$TEMPLATE_NAME" ]]; then
  TEMPLATE_NAME="$(pveam available -section system | awk '
    $0 ~ /debian-12-standard/ {print $2; exit}
  ')"
fi
if [[ -z "$TEMPLATE_NAME" ]]; then
  msg_error "Could not find a Debian standard template via pveam"
  exit 1
fi

TEMPLATE_STORAGE="local"
if ! pvesm status -content vztmpl 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx local; then
  TEMPLATE_STORAGE="$(pvesm status -content vztmpl 2>/dev/null | awk 'NR>1 {print $1; exit}')"
fi
[[ -n "$TEMPLATE_STORAGE" ]] || TEMPLATE_STORAGE="local"

if ! pveam list "$TEMPLATE_STORAGE" | awk '{print $1}' | grep -q "/${TEMPLATE_NAME}$\|${TEMPLATE_NAME}"; then
  msg_info "Downloading template ${TEMPLATE_NAME}"
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE_NAME"
fi
TEMPLATE_PATH="${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE_NAME}"
msg_ok "Template ready (${TEMPLATE_NAME})"

# --- create CT --------------------------------------------------------------
msg_info "Creating LXC ${CTID} (${HN})"
NET_CONFIG="name=eth0,bridge=${BRIDGE},ip=${NET}"
if [[ "$NET" != "dhcp" && "$NET" != *"/"* ]]; then
  msg_error "NET must be 'dhcp' or CIDR like 192.168.1.50/24"
  exit 1
fi

CREATE_ARGS=(
  "$CTID"
  "$TEMPLATE_PATH"
  --hostname "$HN"
  --cores "$CORE"
  --memory "$RAM"
  --swap 512
  --rootfs "${STORAGE}:${DISK}"
  --net0 "$NET_CONFIG"
  --unprivileged "$UNPRIVILEGED"
  --features "$FEATURES"
  --onboot 1
  --timezone host
  --tags "community-script;lxc-updater"
)

if [[ -n "$PASSWORD" ]]; then
  CREATE_ARGS+=(--password "$PASSWORD")
else
  CREATE_ARGS+=(--password "")
fi

pct create "${CREATE_ARGS[@]}"
msg_ok "Created CT ${CTID}"

msg_info "Starting CT ${CTID}"
pct start "$CTID"
# Wait for systemd / pct exec
for i in $(seq 1 60); do
  if pct exec "$CTID" -- true 2>/dev/null; then
    break
  fi
  sleep 1
  if [[ $i -eq 60 ]]; then
    msg_error "CT ${CTID} did not become reachable via pct exec"
    exit 1
  fi
done
msg_ok "CT ${CTID} is running"

msg_info "Waiting for guest network (DHCP/DNS)"
for i in $(seq 1 60); do
  if pct exec "$CTID" -- bash -lc 'getent hosts deb.debian.org >/dev/null 2>&1 || ping -c1 -W1 1.1.1.1 >/dev/null 2>&1'; then
    break
  fi
  sleep 1
  if [[ $i -eq 60 ]]; then
    msg_error "Guest has no network — check bridge ${BRIDGE} / DHCP"
    exit 1
  fi
done
msg_ok "Guest network is ready"

# --- provision Debian + install application ---------------------------------
msg_info "Provisioning Debian environment and installing ${APP}"
pct exec "$CTID" -- mkdir -p /opt/lxc-updater /opt/lxc-updater-data /root/.lxc-updater-install

HOST_TZ="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo UTC)"

if [[ -n "$REPO_ROOT" && -f "$REPO_ROOT/install/in-container-setup.sh" ]]; then
  pct push "$CTID" "$REPO_ROOT/install/in-container-setup.sh" \
    /root/.lxc-updater-install/in-container-setup.sh
  # Copy project tree (exclude bulky/dev artifacts)
  tar -C "$REPO_ROOT" \
    --exclude='./node_modules' \
    --exclude='./.next' \
    --exclude='./data' \
    -czf - . \
    | pct exec "$CTID" -- tar -C /opt/lxc-updater -xzf -
  pct exec "$CTID" -- env \
    APP_PORT="$APP_PORT" \
    ENABLE_SSH_SERVER="$ENABLE_SSH_SERVER" \
    TZ="$HOST_TZ" \
    LXC_UPDATER_BRANCH="$REPO_BRANCH" \
    bash -lc 'chmod +x /root/.lxc-updater-install/in-container-setup.sh; /root/.lxc-updater-install/in-container-setup.sh'
else
  # Clone into the CT, then run the same full guest provisioner
  pct exec "$CTID" -- env \
    LXC_UPDATER_REPO="$REPO_URL" \
    LXC_UPDATER_BRANCH="$REPO_BRANCH" \
    APP_PORT="$APP_PORT" \
    ENABLE_SSH_SERVER="$ENABLE_SSH_SERVER" \
    TZ="$HOST_TZ" \
    bash -s <<'BOOT'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl git
TMP=$(mktemp -d)
git clone --depth 1 --branch "${LXC_UPDATER_BRANCH:-main}" "$LXC_UPDATER_REPO" "$TMP/src"
rm -rf /opt/lxc-updater
mv "$TMP/src" /opt/lxc-updater
chmod +x /opt/lxc-updater/install/in-container-setup.sh
# Source already in APP_DIR — provisioner will detect package.json
APP_PORT="${APP_PORT:-3847}" \
ENABLE_SSH_SERVER="${ENABLE_SSH_SERVER:-0}" \
TZ="${TZ:-UTC}" \
  /opt/lxc-updater/install/in-container-setup.sh
BOOT
fi
msg_ok "Debian environment provisioned and ${APP} installed"

# --- SSH trust to Proxmox host ---------------------------------------------
HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
PUBKEY="$(pct exec "$CTID" -- cat /root/.ssh/id_ed25519.pub 2>/dev/null || true)"

if [[ -n "$PUBKEY" && "$SSH_PUBLISH" == "1" ]]; then
  echo
  msg_info "SSH key for pct exec (from CT → this host)"
  echo -e "${TAB}${BL}${PUBKEY}${CL}"
  echo
  read -r -p "Append this key to /root/.ssh/authorized_keys on THIS host now? [Y/n]: " addkey
  case "${addkey:-Y}" in
    n|N|no|No)
      echo -e "${TAB}Add it later so the app can run: pct exec <vmid> -- …"
      ;;
    *)
      mkdir -p /root/.ssh
      chmod 700 /root/.ssh
      touch /root/.ssh/authorized_keys
      chmod 600 /root/.ssh/authorized_keys
      if ! grep -qxF "$PUBKEY" /root/.ssh/authorized_keys; then
        echo "$PUBKEY" >>/root/.ssh/authorized_keys
      fi
      msg_ok "Authorized CT key on host"
      ;;
  esac
fi

# Seed settings with host IP hints
pct exec "$CTID" -- bash -lc "python3 - <<'PY'
import json, pathlib
p = pathlib.Path('/opt/lxc-updater-data/state.json')
host = '${HOST_IP}'
if not p.exists():
    raise SystemExit(0)
data = json.loads(p.read_text())
s = data.setdefault('settings', {})
if s.get('proxmoxHost') in ('', '192.168.1.10'):
    s['proxmoxHost'] = host or s.get('proxmoxHost', '')
if s.get('sshHost') in ('', '192.168.1.10'):
    s['sshHost'] = host or s.get('sshHost', '')
s['sshPrivateKeyPath'] = '/root/.ssh/id_ed25519'
s['execMode'] = 'ssh'
p.write_text(json.dumps(data, indent=2))
PY"

# --- resolve guest IP -------------------------------------------------------
sleep 2
GUEST_IP="$(pct exec "$CTID" -- bash -lc "hostname -I | awk '{print \$1}'" 2>/dev/null || true)"
if [[ -z "$GUEST_IP" ]]; then
  GUEST_IP="$(
    pct config "$CTID" | sed -n 's/^net0:.*ip=\([^,]*\).*/\1/p' | grep -v '^dhcp$' || true
  )"
fi

msg_ok "Completed successfully!"
echo
echo -e "${GN}${APP} is ready.${CL}"
echo -e "${INFO} CTID ${BL}${CTID}${CL}  hostname ${BL}${HN}${CL}"
if [[ -n "$GUEST_IP" ]]; then
  echo -e "${INFO} Access UI: ${BL}http://${GUEST_IP}:${APP_PORT}${CL}"
else
  echo -e "${INFO} Access UI: ${BL}http://<CT-IP>:${APP_PORT}${CL}"
  echo -e "${TAB}Find IP with: ${BL}pct exec ${CTID} -- hostname -I${CL}"
fi
echo
echo -e "${INFO} Next steps inside the UI → Settings:"
echo -e "${TAB}1. Turn off Mock mode"
echo -e "${TAB}2. Set Proxmox API token ID + secret"
echo -e "${TAB}3. Confirm SSH host is ${BL}${HOST_IP:-<node-ip>}${CL} and key path /root/.ssh/id_ed25519"
echo
echo -e "${INFO} To update this CT later (helper-script style):"
echo -e "${TAB}${BL}pct enter ${CTID}${CL}  then type  ${BL}update${CL}"
echo
