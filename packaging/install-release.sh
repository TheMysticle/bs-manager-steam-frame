#!/usr/bin/env bash
#
# Quick install of a prebuilt BSManager release for aarch64 Linux (Steam Frame / SteamOS).
#
# Downloads the latest prebuilt tarball from this repo's GitHub Releases and installs it
# into $HOME/.local -- no root, and no build toolchain (Node/pnpm/Rust/musl) needed. Safe to
# re-run any time to update to whatever the latest release is.
#
# For building from source instead (e.g. to modify the code, or on x86_64), clone the repo
# and run install.sh there instead.
#
# Usage:
#   curl -fsSL https://github.com/TheMysticle/bs-manager-steam-frame/releases/latest/download/install-release.sh | bash

set -euo pipefail

RELEASE_URL="https://github.com/TheMysticle/bs-manager-steam-frame/releases/latest/download/bs-manager-frame-aarch64.tar.gz"
APP_NAME="bs-manager"
LOCAL_ROOT="${HOME}/.local"
BIN_DIR="${LOCAL_ROOT}/bin"
OPT_DIR="${LOCAL_ROOT}/opt/${APP_NAME}"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || die "this script only targets Linux (Steam Frame / SteamOS)"
[ "$(uname -m)" = "aarch64" ] || die "this is a prebuilt aarch64 release; detected $(uname -m). For x86_64, build from source: clone the repo and run install.sh."

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

log "Downloading latest release"
curl -fsSL "$RELEASE_URL" -o "$TMPDIR/release.tar.gz"

log "Verifying archive integrity"
gzip -t "$TMPDIR/release.tar.gz" || die "downloaded archive failed integrity check -- try again"

log "Extracting"
mkdir -p "$TMPDIR/extracted"
tar -xzf "$TMPDIR/release.tar.gz" -C "$TMPDIR/extracted"

log "Installing to ${OPT_DIR}"
mkdir -p "$LOCAL_ROOT" "$BIN_DIR"
rm -rf "${OPT_DIR}.new"
cp -r "$TMPDIR/extracted/app" "${OPT_DIR}.new"
rm -rf "$OPT_DIR"
mv "${OPT_DIR}.new" "$OPT_DIR"

log "Installing launcher, desktop entry and icons"
install -Dm755 "$TMPDIR/extracted/bs-manager-launcher.sh" "${BIN_DIR}/bs-manager"
mkdir -p "${LOCAL_ROOT}/share/applications"
# Desktop launchers (e.g. Steam's Big Picture / gamescope session) often run with a minimal
# PATH that doesn't include ~/.local/bin, so a bare "Exec=bs-manager" can fail even though it
# works fine from an interactive shell. Bake in the absolute path.
sed "s#^Exec=bs-manager #Exec=${BIN_DIR}/bs-manager #" \
    "$TMPDIR/extracted/bs-manager.desktop" > "${LOCAL_ROOT}/share/applications/bs-manager.desktop"
chmod 644 "${LOCAL_ROOT}/share/applications/bs-manager.desktop"
install -Dm644 "$TMPDIR/extracted/icons/icon.svg" "${LOCAL_ROOT}/share/icons/hicolor/scalable/apps/bs-manager.svg"
for size in 16 24 32 128 256; do
    install -Dm644 "$TMPDIR/extracted/icons/${size}x${size}.png" \
        "${LOCAL_ROOT}/share/icons/hicolor/${size}x${size}/apps/bs-manager.png"
done

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${LOCAL_ROOT}/share/applications" || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache "${LOCAL_ROOT}/share/icons/hicolor" || true
fi

log "Done. Launch from your desktop's app list ('BSManager'), or run: ${BIN_DIR}/bs-manager"
log "See README.md for the Steam launch-options fix needed for mods to load when Beat Saber is launched directly from Steam."
log "This installed a prebuilt release. To build from source instead (e.g. to modify the code), clone the repo and run install.sh."
