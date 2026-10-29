#!/usr/bin/env bash
# LXC Updater — in-CT update (GitHub refresh + rebuild)
# Installed as /usr/bin/update. Takes a full app-tree backup before changing
# sources; on failure restores that backup and restarts the service.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lxc-updater}"
DATA_DIR="${LXC_UPDATER_DATA_DIR:-/opt/lxc-updater-data}"
DEFAULT_GH_REPO="nasagreir/lxc-update-manager"
DEFAULT_REPO_URL="https://github.com/nasagreir/lxc-update-manager.git"
DEFAULT_BRANCH="main"

if [[ -f "$APP_DIR/.lxc-updater-source" ]]; then
  # shellcheck disable=SC1091
  source "$APP_DIR/.lxc-updater-source"
fi
GH_REPO="${LXC_UPDATER_GH_REPO:-${DEFAULT_GH_REPO}}"
REPO_URL="${LXC_UPDATER_REPO:-${DEFAULT_REPO_URL}}"
BRANCH="${LXC_UPDATER_BRANCH:-${DEFAULT_BRANCH}}"

BACKUP_DIR=""
ROLLED_BACK=0
UPDATE_STARTED=0

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

refresh_from_github_tarball() {
  local tmp extracted
  tmp="$(mktemp -d)"
  echo "Downloading https://github.com/${GH_REPO}/archive/refs/heads/${BRANCH}.tar.gz …"
  curl -fsSL "https://github.com/${GH_REPO}/archive/refs/heads/${BRANCH}.tar.gz" \
    | tar -xz -C "$tmp"
  extracted="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [[ -z "$extracted" || ! -f "$extracted/package.json" ]]; then
    echo "Failed to extract GitHub sources for ${GH_REPO}@${BRANCH}" >&2
    rm -rf "$tmp"
    return 1
  fi
  rsync -a --delete \
    --exclude 'data' \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude '.lxc-updater-source' \
    "$extracted"/ "$APP_DIR"/
  cat >"$APP_DIR/.lxc-updater-source" <<SRCEOF
LXC_UPDATER_GH_REPO=${GH_REPO}
LXC_UPDATER_REPO=${REPO_URL}
LXC_UPDATER_BRANCH=${BRANCH}
SRCEOF
  rm -rf "$tmp"
}

link_persistent_data() {
  mkdir -p "$DATA_DIR"
  if [[ -f "$APP_DIR/data/state.json" && ! -L "$APP_DIR/data" && ! -f "$DATA_DIR/state.json" ]]; then
    mv "$APP_DIR/data/state.json" "$DATA_DIR/"
  fi
  rm -rf "$APP_DIR/data"
  ln -sfn "$DATA_DIR" "$APP_DIR/data"
}

prepare_data_for_build() {
  # Turbopack panics if data/ is a symlink outside the app tree (and can keep
  # that failure in .next filesystem cache). Always use a real empty data dir
  # and a clean .next for the build; persistent data lives in DATA_DIR.
  rm -rf "$APP_DIR/data" "$APP_DIR/.next"
  mkdir -p "$APP_DIR/data"
  # Prefer the absolute data dir at runtime so builds never need ./data.
  export LXC_UPDATER_DATA_DIR="${LXC_UPDATER_DATA_DIR:-$DATA_DIR}"
}

install_helper_commands() {
  if [[ -f "$APP_DIR/scripts/lxc-updater-update.sh" ]]; then
    install -m 755 "$APP_DIR/scripts/lxc-updater-update.sh" /usr/bin/update
  fi
  if [[ -f "$APP_DIR/scripts/lxc-updater-passwd.mjs" ]]; then
    cat >/usr/bin/lxc-updater-passwd <<'PASSWD'
#!/usr/bin/env bash
set -euo pipefail
export LXC_UPDATER_DATA_DIR="${LXC_UPDATER_DATA_DIR:-/opt/lxc-updater-data}"
exec node /opt/lxc-updater/scripts/lxc-updater-passwd.mjs "$@"
PASSWD
    chmod +x /usr/bin/lxc-updater-passwd
    chmod +x "$APP_DIR/scripts/lxc-updater-passwd.mjs" || true
  fi
}

create_backup() {
  BACKUP_DIR="$(mktemp -d /var/tmp/lxc-updater-backup.XXXXXX)"
  echo "Creating rollback backup at ${BACKUP_DIR} …"
  mkdir -p "$BACKUP_DIR/app"
  # Copy the working app tree. Skip data/ contents (live under DATA_DIR);
  # recreate the data symlink after so restore points at the same store.
  rsync -a \
    --exclude 'data' \
    "$APP_DIR"/ "$BACKUP_DIR/app/"
  if [[ -L "$APP_DIR/data" ]]; then
    ln -sfn "$(readlink -f "$APP_DIR/data" 2>/dev/null || readlink "$APP_DIR/data")" \
      "$BACKUP_DIR/app/data"
  else
    mkdir -p "$BACKUP_DIR/app/data"
  fi
  echo "Backup ready."
}

restore_backup() {
  local ec="${1:-1}"
  if [[ "$ROLLED_BACK" -eq 1 ]]; then
    return 0
  fi
  ROLLED_BACK=1
  if [[ -z "$BACKUP_DIR" || ! -d "$BACKUP_DIR/app" ]]; then
    echo "✖ Update failed (exit ${ec}) and no backup is available to restore." >&2
    systemctl start lxc-updater.service 2>/dev/null || true
    return 0
  fi
  echo
  echo "✖ Update failed (exit ${ec}). Restoring previous installation from backup…"
  systemctl stop lxc-updater.service 2>/dev/null || true
  rsync -a --delete \
    --exclude 'data' \
    "$BACKUP_DIR/app"/ "$APP_DIR"/
  link_persistent_data
  install_helper_commands || true
  systemctl start lxc-updater.service 2>/dev/null || true
  echo "✔ Previous version restored and lxc-updater.service restarted."
  echo "  (Settings/jobs in ${DATA_DIR} were not modified.)"
  rm -rf "$BACKUP_DIR"
  BACKUP_DIR=""
}

on_err() {
  local ec=$?
  if [[ "$UPDATE_STARTED" -eq 0 ]]; then
    exit "$ec"
  fi
  restore_backup "$ec"
  exit "$ec"
}

on_exit() {
  local ec=$?
  if [[ "$ec" -eq 0 && "$ROLLED_BACK" -eq 0 && -n "$BACKUP_DIR" && -d "$BACKUP_DIR" ]]; then
    echo "Removing backup ${BACKUP_DIR}"
    rm -rf "$BACKUP_DIR"
  fi
}

trap on_err ERR
trap on_exit EXIT

header
if [[ ! -d "$APP_DIR/.git" && ! -f "$APP_DIR/package.json" ]]; then
  echo "No LXC Updater installation found in $APP_DIR"
  exit 1
fi

echo "This will:"
echo "  • snapshot the current app to a temp backup (auto-restore on failure)"
echo "  • refresh Debian packages (optional)"
echo "  • pull the latest app code from GitHub (${GH_REPO}@${BRANCH})"
echo "  • rebuild and restart lxc-updater"
echo "App data in ${DATA_DIR} is preserved (settings, jobs, API keys)."
echo
if ! ask_yes "Proceed with update?"; then
  echo "Aborted."
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
if ask_yes "Also run apt update && dist-upgrade first?"; then
  apt-get update -y
  apt-get -y -o Dpkg::Options::="--force-confdef" \
    -o Dpkg::Options::="--force-confold" dist-upgrade
fi

# Needed for backup + GitHub tarball refresh.
apt-get install -y --no-install-recommends curl ca-certificates rsync >/dev/null

# Snapshot before any app-tree changes so a failed build can roll back.
create_backup
UPDATE_STARTED=1

systemctl stop lxc-updater.service || true

if [[ -d "$APP_DIR/.git" ]]; then
  cd "$APP_DIR"
  git remote set-url origin "$REPO_URL" 2>/dev/null || \
    git remote add origin "$REPO_URL" 2>/dev/null || true
  git fetch --depth 1 origin "$BRANCH" || git fetch --depth 1 origin
  git reset --hard "origin/${BRANCH}" 2>/dev/null || git pull --ff-only || true
else
  refresh_from_github_tarball
fi

cd "$APP_DIR"
prepare_data_for_build
npm install
npm run build
link_persistent_data
install_helper_commands

systemctl start lxc-updater.service
# Give systemd a moment, then require an active unit or roll back.
sleep 2
if ! systemctl is-active --quiet lxc-updater.service; then
  echo "lxc-updater.service did not become active after update." >&2
  systemctl --no-pager --full status lxc-updater.service || true
  false
fi

echo
echo "Update complete. Service status:"
systemctl --no-pager --full status lxc-updater.service || true
if [[ -x /usr/bin/lxc-updater-passwd ]]; then
  echo "Password reset: lxc-updater-passwd --reset"
fi
