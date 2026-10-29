#!/usr/bin/env bash
# Create/update the public GitHub mirror and push main.
# Requires: gh auth (GH_TOKEN or gh auth login) with permission to create repos
# under the target owner.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OWNER_REPO="${1:-greir-hull/lxc-update-manager}"
OWNER="${OWNER_REPO%%/*}"
NAME="${OWNER_REPO##*/}"
GH_URL="https://github.com/${OWNER_REPO}.git"

cd "$ROOT"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required" >&2
  exit 1
fi

if ! gh auth status -h github.com >/dev/null 2>&1; then
  if [[ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
    printf '%s\n' "${GH_TOKEN:-$GITHUB_TOKEN}" | gh auth login --hostname github.com --with-token
  else
    echo "Not logged into GitHub. Set GH_TOKEN or run: gh auth login" >&2
    exit 1
  fi
fi

bash "$ROOT/scripts/build-one-line-installer.sh"

if gh repo view "$OWNER_REPO" >/dev/null 2>&1; then
  echo "Repo $OWNER_REPO already exists"
  # Ensure public for anonymous raw.githubusercontent.com installs
  gh repo edit "$OWNER_REPO" --visibility public --accept-visibility-change-consequences 2>/dev/null \
    || echo "(visibility unchanged — may already be public or lack admin)"
else
  echo "Creating public repo $OWNER_REPO"
  gh repo create "$OWNER_REPO" --public --description "Proxmox LXC Updater — web UI + host installer" >/dev/null
fi

if git remote get-url github >/dev/null 2>&1; then
  git remote set-url github "$GH_URL"
else
  git remote add github "$GH_URL"
fi

git push -u github main
echo
echo "Published: https://github.com/${OWNER_REPO}"
echo "One-liner:"
echo "  bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/${OWNER_REPO}/main/install.sh)\""
