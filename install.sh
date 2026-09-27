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
STATE_DIR="${LOCAL_ROOT}/share/bs-manager-steam-frame"
STATE_FILE="${STATE_DIR}/install-state.env"
BUILD_MARKER="${STATE_DIR}/build-in-progress"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

# Build byproducts (node_modules, dist, release, an in-flight OPT_DIR swap)
# have no integrity check of their own, unlike the toolchains below (musl is
# sha256-verified, rust targets are checked via rustup, volta via command -v)
# -- so a run that died partway through can leave them silently corrupt in a
# way a plain rerun won't notice. Safe to always nuke and regenerate.
clean_build_artifacts() {
    # release/app/{package.json,pnpm-lock.yaml,pnpm-workspace.yaml} are
    # tracked source files (electron-react-boilerplate's two-package.json
    # layout), not build output -- only release/build is electron-builder's
    # generated output dir (see directories.output in electron-builder.config.js),
    # so that's all that's safe to nuke here.
    rm -rf "${REPO_ROOT}/node_modules" "${REPO_ROOT}/dist" "${REPO_ROOT}/release/build" "${OPT_DIR}.new"
    find "${REPO_ROOT}/externals" -maxdepth 2 -type d -name target -exec rm -rf {} + 2>/dev/null || true
    rm -f "$BUILD_MARKER"
}

on_error() {
    local st=$?
    printf '\033[1;31mFAILED\033[0m (exit %s) at line %s: %s\n' "$st" "$LINENO" "$BASH_COMMAND" >&2
    if [ -f "$BUILD_MARKER" ]; then
        log "Cleaning up partial build state so the next run starts fresh"
        clean_build_artifacts
    fi
}
on_interrupt() {
    printf '\033[1;31mInterrupted\033[0m -- cleaning up partial build state\n' >&2
    [ -f "$BUILD_MARKER" ] && clean_build_artifacts
    exit 130
}
trap on_error ERR
trap on_interrupt INT TERM

# Tracks which toolchains this script installed itself (as opposed to ones
# that were already on the system), so uninstall.sh only removes what it
# added. Flags only ever go 0 -> 1 across reruns, never back down, so a
# toolchain installed on an earlier run is still remembered as "ours" later.
FRESH_VOLTA=0
FRESH_RUSTUP=0
FRESH_RUST_TARGET=0
# shellcheck disable=SC1090
[ -f "$STATE_FILE" ] && source "$STATE_FILE"

[ "$(uname -s)" = "Linux" ] || die "this script only targets Linux (Steam Frame / SteamOS)"
[ "$(uname -m)" = "aarch64" ] || die "this script only targets aarch64; detected $(uname -m). For x86_64 use the upstream AUR package instead."

mkdir -p "$BIN_DIR" "$MUSL_DIR" "$STATE_DIR"
export PATH="$BIN_DIR:${HOME}/.volta/bin:$PATH"

if [ -f "$BUILD_MARKER" ]; then
    log "Previous run left an incomplete build (it crashed or was interrupted) -- cleaning up before starting again"
    clean_build_artifacts
fi

# release/app/{package.json,pnpm-lock.yaml,pnpm-workspace.yaml} are tracked
# source files, not build output. An older version of this script's cleanup
# deleted them along with the real byproducts; self-heal that here so a
# checkout left in that state doesn't require a manual `git checkout` first.
if [ ! -f "${REPO_ROOT}/release/app/package.json" ]; then
    git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
        || die "release/app/package.json is missing and ${REPO_ROOT} isn't a git checkout -- can't self-heal, re-clone the repo"
    log "release/app is missing (likely wiped by an older or interrupted run) -- restoring it from git"
    git -C "$REPO_ROOT" checkout -- release/app
fi

# ---------------------------------------------------------------------------
# Volta + pinned Node
# ---------------------------------------------------------------------------
if ! command -v volta >/dev/null 2>&1; then
    log "Installing Volta"
    curl -fsSL https://get.volta.sh | bash -s -- --skip-setup
    export PATH="${HOME}/.volta/bin:$PATH"
    FRESH_VOLTA=1
fi
command -v volta >/dev/null 2>&1 || die "volta install did not put 'volta' on PATH"

log "Ensuring Node ${NODE_VERSION} via Volta"
volta install "node@${NODE_VERSION}"

NODE_IMG_DIR="$(find "${HOME}/.volta/tools/image/node" -maxdepth 1 -type d -name "${NODE_VERSION}.*" 2>/dev/null | sort -V | tail -n1)"
[ -n "$NODE_IMG_DIR" ] || die "could not find volta's node@${NODE_VERSION} image directory"
VOLTA_COREPACK="${NODE_IMG_DIR}/bin/corepack"
[ -x "$VOLTA_COREPACK" ] || die "corepack binary not found at $VOLTA_COREPACK (unexpected Node layout)"

# Put the real node binary directory on PATH directly, ahead of volta's
# shim, so the frozen-lockfile install/build below doesn't depend on
# volta-shim's runtime version resolution succeeding -- one less moving
# part for a step we can't easily retry by hand.
export PATH="${NODE_IMG_DIR}/bin:$PATH"
hash -r
command -v node >/dev/null 2>&1 || die "node still not on PATH after installing via volta (looked in ${NODE_IMG_DIR}/bin)"
log "Using node $(node --version) from ${NODE_IMG_DIR}"

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
    FRESH_RUSTUP=1
fi
# shellcheck disable=SC1090
[ -f "${HOME}/.cargo/env" ] && source "${HOME}/.cargo/env"
command -v rustup >/dev/null 2>&1 || die "rustup install did not put 'rustup' on PATH"

log "Ensuring rust target ${RUST_TARGET}"
if ! rustup target list --installed | grep -qx "$RUST_TARGET"; then
    FRESH_RUST_TARGET=1
fi
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
touch "$BUILD_MARKER"
log "Installing JS dependencies (pnpm install --frozen-lockfile)"
cd "$REPO_ROOT"
pnpm install --frozen-lockfile

log "Building bundled Rust helpers (aarch64-unknown-linux-musl)"
# aws-lc-sys ships LTO bytecode objects that musl-gcc's linker can't
# materialize; strip -flto=auto if the environment injected it.
export CFLAGS="${CFLAGS-}"
export LDFLAGS="${LDFLAGS-}"
CFLAGS="${CFLAGS/ -flto=auto/}"
LDFLAGS="${LDFLAGS/ -flto=auto/}"
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
rm -rf "${OPT_DIR}.new"
mkdir -p "${OPT_DIR}.new"
cp -r "${UNPACKED_DIR}/." "${OPT_DIR}.new/"
rm -rf "$OPT_DIR"
mv "${OPT_DIR}.new" "$OPT_DIR"

log "Installing launcher, desktop entry and icons"
install -Dm755 "${REPO_ROOT}/packaging/bs-manager-launcher.sh" "${BIN_DIR}/bs-manager"
# Desktop launchers (e.g. Steam's Big Picture / gamescope session) often run
# with a minimal PATH that doesn't include ~/.local/bin, so a bare
# "Exec=bs-manager" can fail with "cannot find program bs-manager" even
# though it works fine from an interactive shell. Bake in the absolute path.
mkdir -p "${LOCAL_ROOT}/share/applications"
sed "s#^Exec=bs-manager #Exec=${BIN_DIR}/bs-manager #" \
    "${REPO_ROOT}/packaging/bs-manager.desktop" > "${LOCAL_ROOT}/share/applications/bs-manager.desktop"
chmod 644 "${LOCAL_ROOT}/share/applications/bs-manager.desktop"
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

# ---------------------------------------------------------------------------
# Record what we installed, then clean up build byproducts
# ---------------------------------------------------------------------------
log "Recording install state for uninstall.sh"
mkdir -p "$STATE_DIR"
cat > "$STATE_FILE" <<EOF
FRESH_VOLTA=${FRESH_VOLTA}
FRESH_RUSTUP=${FRESH_RUSTUP}
FRESH_RUST_TARGET=${FRESH_RUST_TARGET}
EOF

log "Cleaning up build byproducts (already copied into ${OPT_DIR})"
clean_build_artifacts

log "Done. Launch from your desktop's app list ('BSManager'), or run: ${BIN_DIR}/bs-manager"
log "See README.md for the Steam launch-options fix needed for mods to load when Beat Saber is launched directly from Steam."
log "Re-running this script later (e.g. after 'git pull') will rebuild from scratch, since the build byproducts above were just removed."
log "To remove everything this script installed, run ./uninstall.sh"
