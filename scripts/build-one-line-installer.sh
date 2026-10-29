#!/usr/bin/env bash
# Rebuilds the self-contained root install.sh (embedded app sources).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/install.sh}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "Packing application sources…"
tar -C "$ROOT" \
  --exclude='./node_modules' \
  --exclude='./.next' \
  --exclude='./data' \
  --exclude='./.git' \
  --exclude='./install.sh' \
  --exclude='./dist' \
  -czf "$STAGE/app.tgz" .

if base64 -w0 "$STAGE/app.tgz" >"$STAGE/app.b64" 2>/dev/null; then
  :
else
  base64 "$STAGE/app.tgz" | tr -d '\n' >"$STAGE/app.b64"
fi

HOST_LOGIC="$ROOT/install/proxmox-ve.sh"
[[ -f "$HOST_LOGIC" ]] || { echo "missing $HOST_LOGIC" >&2; exit 1; }

{
  cat <<'HEADER'
#!/usr/bin/env bash
# =============================================================================
# LXC Updater — one-line Proxmox host installer (self-contained)
# =============================================================================
# Paste on the Proxmox VE host shell (Datacenter → node → Shell):
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/greir-hull/lxc-update-manager/main/install.sh)"
#
# Repo: https://github.com/greir-hull/lxc-update-manager
# Or copy this file to the host and run:  bash install.sh
#
# Optional: CTID=210 HN=lxc-updater INSTALL_MODE=default bash install.sh
# Later updates inside the CT:  pct enter <CTID>  then type  update
# =============================================================================

lxc_updater_has_payload() { return 0; }

# Emits the embedded application archive (tar.gz, base64, one line).
lxc_updater_payload_b64() {
  cat <<'LXC_UPDATER_PAYLOAD_EOF'
HEADER
  cat "$STAGE/app.b64"
  printf '\n'
  cat <<'MID'
LXC_UPDATER_PAYLOAD_EOF
}

lxc_updater_extract_payload() {
  local dest="${1:?destination directory required}"
  mkdir -p "$dest"
  if lxc_updater_payload_b64 | base64 -d 2>/dev/null | tar -xzf - -C "$dest"; then
    return 0
  fi
  lxc_updater_payload_b64 | base64 --decode | tar -xzf - -C "$dest"
}

# --- host installer (from install/proxmox-ve.sh) ----------------------------
MID
  # Skip the shebang line from the host logic file.
  tail -n +2 "$HOST_LOGIC"
} >"$OUT"

chmod +x "$OUT"
bash -n "$OUT"
BYTES=$(wc -c <"$OUT" | tr -d ' ')
echo "Wrote $OUT (${BYTES} bytes), syntax OK"

# Smoke-test payload extraction
bash <<TEST
set -euo pipefail
$(sed -n '/^lxc_updater_has_payload/,/^# --- host installer/p' "$OUT" | sed '$d')
tmpdir=\$(mktemp -d)
lxc_updater_extract_payload "\$tmpdir"
test -f "\$tmpdir/package.json"
test -f "\$tmpdir/install/in-container-setup.sh"
rm -rf "\$tmpdir"
echo "Payload extract smoke test OK"
TEST
