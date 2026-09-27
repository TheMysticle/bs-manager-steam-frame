#!/usr/bin/env bash
#
# One-shot user-local build + install of BSManager for aarch64 Linux
# (Steam Frame / SteamOS). Safe to re-run: every step checks its own
# completion state first.
#
# Installs into $HOME/.local so it needs no root and doesn't touch the
# SteamOS read-only root filesystem.

set -euo pipefail

NODE_VERSION="24"
PNPM_VERSION="10.34.4"
RUST_TARGET="aarch64-unknown-linux-musl"
MUSL_PKG_VERSION="1.2.6-2"
MUSL_PKG_URL="http://mirror.archlinuxarm.org/aarch64/extra/musl-${MUSL_PKG_VERSION}-aarch64.pkg.tar.xz"
# Verified against Arch Linux ARM's own extra.db repo index for this build.
MUSL_PKG_SHA256="400c498fdd6ee680ab6e83982172f21de3f7624aafc5cbc097d2ddfbcd9e36d1"

APP_NAME="bs-manager"
LOCAL_ROOT="${HOME}/.local"
BIN_DIR="${LOCAL_ROOT}/bin"
MUSL_DIR="${LOCAL_ROOT}/musl"
OPT_DIR="${LOCAL_ROOT}/opt/${APP_NAME}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }
trap 'st=$?; [ $st -ne 0 ] && printf "\033[1;31mFAILED\033[0m (exit %s) at line %s: %s\n" "$st" "$LINENO" "$BASH_COMMAND" >&2' ERR

[ "$(uname -s)" = "Linux" ] || die "this script only targets Linux (Steam Frame / SteamOS)"
[ "$(uname -m)" = "aarch64" ] || die "this script only targets aarch64; detected $(uname -m). For x86_64 use the upstream AUR package instead."

mkdir -p "$BIN_DIR" "$MUSL_DIR"
export PATH="$BIN_DIR:${HOME}/.volta/bin:$PATH"

# ---------------------------------------------------------------------------
# Volta + pinned Node
# ---------------------------------------------------------------------------
if ! command -v volta >/dev/null 2>&1; then
    log "Installing Volta"
    curl -fsSL https://get.volta.sh | bash -s -- --skip-setup
    export PATH="${HOME}/.volta/bin:$PATH"
fi
command -v volta >/dev/null 2>&1 || die "volta install did not put 'volta' on PATH"

log "Ensuring Node ${NODE_VERSION} via Volta"
volta install "node@${NODE_VERSION}"

NODE_IMG_DIR="$(find "${HOME}/.volta/tools/image/node" -maxdepth 1 -type d -name "${NODE_VERSION}.*" 2>/dev/null | sort -V | tail -n1)"
[ -n "$NODE_IMG_DIR" ] || die "could not find volta's node@${NODE_VERSION} image directory"
VOLTA_COREPACK="${NODE_IMG_DIR}/bin/corepack"
[ -x "$VOLTA_COREPACK" ] || die "corepack binary not found at $VOLTA_COREPACK (unexpected Node layout)"

# ---------------------------------------------------------------------------
# pnpm via Corepack, pinned to the version this repo's package.json requires
# ---------------------------------------------------------------------------
log "Enabling Corepack shims (pnpm/yarn) into ${BIN_DIR}"
"$VOLTA_COREPACK" enable --install-directory "$BIN_DIR"

REQUIRED_PM="pnpm@${PNPM_VERSION}"
ACTUAL_PM="$(node -e "console.log(require('${REPO_ROOT}/package.json').packageManager)" 2>/dev/null || true)"
[ "$ACTUAL_PM" = "$REQUIRED_PM" ] || die "repo's package.json packageManager ($ACTUAL_PM) doesn't match expected $REQUIRED_PM -- pin out of date, update this script"

command -v pnpm >/dev/null 2>&1 || die "pnpm shim not found on PATH after 'corepack enable'"

# ---------------------------------------------------------------------------
# Rust + aarch64-musl target
# ---------------------------------------------------------------------------
if ! command -v rustup >/dev/null 2>&1; then
    log "Installing rustup"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
# shellcheck disable=SC1090
[ -f "${HOME}/.cargo/env" ] && source "${HOME}/.cargo/env"
command -v rustup >/dev/null 2>&1 || die "rustup install did not put 'rustup' on PATH"

log "Ensuring rust target ${RUST_TARGET}"
rustup target add "$RUST_TARGET"

# ---------------------------------------------------------------------------
# musl-gcc cross toolchain (SteamOS doesn't ship one)
# ---------------------------------------------------------------------------
MUSL_SPECS="${MUSL_DIR}/musl-gcc.specs"
MUSL_WRAPPER="${BIN_DIR}/musl-gcc"
MUSL_STAMP="${MUSL_DIR}/.verified-sha256-${MUSL_PKG_SHA256}"

if [ ! -f "$MUSL_STAMP" ]; then
    log "Fetching musl ${MUSL_PKG_VERSION} for aarch64"
    MUSL_TMP="$(mktemp -d)"
    trap 'rm -rf "$MUSL_TMP"' EXIT
    curl -fL --retry 3 -o "${MUSL_TMP}/musl.pkg.tar.xz" "$MUSL_PKG_URL"

    ACTUAL_SHA256="$(sha256sum "${MUSL_TMP}/musl.pkg.tar.xz" | cut -d' ' -f1)"
    [ "$ACTUAL_SHA256" = "$MUSL_PKG_SHA256" ] || die "musl package checksum mismatch: got $ACTUAL_SHA256, expected $MUSL_PKG_SHA256 -- refusing to extract a package that doesn't match Arch Linux ARM's published checksum"

    rm -rf "${MUSL_DIR:?}"/usr
    mkdir -p "$MUSL_DIR"
    tar -xf "${MUSL_TMP}/musl.pkg.tar.xz" -C "$MUSL_DIR"
    touch "$MUSL_STAMP"
    rm -rf "$MUSL_TMP"
    trap - EXIT
else
    log "musl ${MUSL_PKG_VERSION} already downloaded and verified, skipping"
fi

log "Patching musl-gcc specs for user-local install path"
sed \
    -e "s#/usr/lib/musl#${MUSL_DIR}/usr/lib/musl#g" \
    -e "s#/lib/ld-musl-aarch64.so.1#${MUSL_DIR}/usr/lib/ld-musl-aarch64.so.1#g" \
    "${MUSL_DIR}/usr/lib/musl/lib/musl-gcc.specs" > "$MUSL_SPECS"

cat > "$MUSL_WRAPPER" <<'EOF'
#!/bin/sh
# Generated by install.sh -- wraps the system gcc with musl's specs file.
exec "${REALGCC:-gcc}" "$@" -specs "MUSL_SPECS_PLACEHOLDER"
EOF
sed -i "s#MUSL_SPECS_PLACEHOLDER#${MUSL_SPECS}#" "$MUSL_WRAPPER"
chmod +x "$MUSL_WRAPPER"

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
log "Installing JS dependencies (pnpm install --frozen-lockfile)"
cd "$REPO_ROOT"
pnpm install --frozen-lockfile

log "Building bundled Rust helpers (aarch64-unknown-linux-musl)"
# aws-lc-sys ships LTO bytecode objects that musl-gcc's linker can't
# materialize; strip -flto=auto if the environment injected it.
export CFLAGS="${CFLAGS/ -flto=auto/}"
export LDFLAGS="${LDFLAGS/ -flto=auto/}"
pnpm run build-rust-scripts

log "Building BSManager"
pnpm run build

log "Packaging with electron-builder (unpacked aarch64 dir)"
pnpm exec electron-builder --config electron-builder.config.js --publish never --linux dir --arm64

UNPACKED_DIR="${REPO_ROOT}/release/build/linux-arm64-unpacked"
[ -d "$UNPACKED_DIR" ] || die "expected electron-builder output at $UNPACKED_DIR, not found"

# ---------------------------------------------------------------------------
# Install into $HOME/.local
# ---------------------------------------------------------------------------
log "Installing to ${OPT_DIR}"
rm -rf "$OPT_DIR"
mkdir -p "$OPT_DIR"
cp -r "${UNPACKED_DIR}/." "$OPT_DIR/"

log "Installing launcher, desktop entry and icons"
install -Dm755 "${REPO_ROOT}/packaging/bs-manager-launcher.sh" "${BIN_DIR}/bs-manager"
install -Dm644 "${REPO_ROOT}/packaging/bs-manager.desktop" "${LOCAL_ROOT}/share/applications/bs-manager.desktop"
install -Dm644 "${REPO_ROOT}/resources/readme/SVG/icon.svg" "${LOCAL_ROOT}/share/icons/hicolor/scalable/apps/bs-manager.svg"
for size in 16 24 32 128 256; do
    install -Dm644 "${REPO_ROOT}/build/icons/png/${size}x${size}.png" \
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
