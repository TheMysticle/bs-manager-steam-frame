#!/usr/bin/env bash
#
# Removes everything install.sh put on this system. Only removes toolchains
# (Volta, rustup) that install.sh installed itself -- if they already
# existed before install.sh ran, they (and anything else you use them for)
# are left alone. The BSManager app, launcher, desktop entry, icons, and the
# dedicated musl cross-toolchain are always removed, since install.sh is the
# only thing that ever creates them.
#
# Safe to re-run.

set -euo pipefail

APP_NAME="bs-manager"
LOCAL_ROOT="${HOME}/.local"
BIN_DIR="${LOCAL_ROOT}/bin"
MUSL_DIR="${LOCAL_ROOT}/musl"
OPT_DIR="${LOCAL_ROOT}/opt/${APP_NAME}"
STATE_DIR="${LOCAL_ROOT}/share/bs-manager-steam-frame"
STATE_FILE="${STATE_DIR}/install-state.env"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }
trap 'st=$?; [ $st -ne 0 ] && printf "\033[1;31mFAILED\033[0m (exit %s) at line %s: %s\n" "$st" "$LINENO" "$BASH_COMMAND" >&2' ERR

ASSUME_YES=0
for arg in "$@"; do
    case "$arg" in
        -y|--yes) ASSUME_YES=1 ;;
        *) die "unknown argument: $arg (supported: -y/--yes)" ;;
    esac
done

FRESH_VOLTA=0
FRESH_RUSTUP=0
FRESH_RUST_TARGET=0
if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
else
    log "No install-state.env found at ${STATE_FILE} -- assuming Volta/rustup pre-existed and leaving them untouched"
fi

echo "This will remove:"
echo "  - ${OPT_DIR} (the installed app)"
echo "  - ${BIN_DIR}/bs-manager (launcher), desktop entry, and icons"
echo "  - ${MUSL_DIR} and ${BIN_DIR}/musl-gcc (musl cross-toolchain built by install.sh)"
echo "  - ${BIN_DIR}/pnpm, pnpx, yarn, yarnpkg (Corepack shims install.sh placed here)"
[ "$FRESH_VOLTA" = "1" ] && echo "  - ${HOME}/.volta (installed fresh by install.sh)"
[ "$FRESH_RUSTUP" = "1" ] && echo "  - ${HOME}/.rustup and ${HOME}/.cargo (installed fresh by install.sh)"
[ "$FRESH_RUSTUP" != "1" ] && [ "$FRESH_RUST_TARGET" = "1" ] && echo "  - the aarch64-unknown-linux-musl rustup target (added by install.sh; rustup itself is kept)"

if [ "$ASSUME_YES" != "1" ]; then
    printf "Continue? [y/N] "
    read -r reply
    case "$reply" in
        y|Y|yes|YES) ;;
        *) echo "Aborted, nothing removed."; exit 0 ;;
    esac
fi

log "Removing app, launcher, desktop entry, and icons"
rm -rf "$OPT_DIR"
rm -f "${BIN_DIR}/bs-manager"
rm -f "${LOCAL_ROOT}/share/applications/bs-manager.desktop"
rm -f "${LOCAL_ROOT}/share/icons/hicolor/scalable/apps/bs-manager.svg"
for size in 16 24 32 128 256; do
    rm -f "${LOCAL_ROOT}/share/icons/hicolor/${size}x${size}/apps/bs-manager.png"
done
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${LOCAL_ROOT}/share/applications" || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache "${LOCAL_ROOT}/share/icons/hicolor" || true
fi

log "Removing musl cross-toolchain"
rm -rf "$MUSL_DIR"
rm -f "${BIN_DIR}/musl-gcc"

log "Removing Corepack shims installed by install.sh"
rm -f "${BIN_DIR}/pnpm" "${BIN_DIR}/pnpx" "${BIN_DIR}/yarn" "${BIN_DIR}/yarnpkg"

if [ "$FRESH_VOLTA" = "1" ]; then
    log "Removing Volta (install.sh installed it fresh)"
    rm -rf "${HOME}/.volta"
else
    log "Volta pre-existed before install.sh; leaving it alone"
fi

if [ "$FRESH_RUSTUP" = "1" ]; then
    log "Removing rustup (install.sh installed it fresh)"
    if command -v rustup >/dev/null 2>&1; then
        rustup self uninstall -y
    else
        rm -rf "${HOME}/.rustup" "${HOME}/.cargo"
    fi
elif [ "$FRESH_RUST_TARGET" = "1" ]; then
    log "rustup pre-existed; removing only the aarch64-unknown-linux-musl target install.sh added"
    command -v rustup >/dev/null 2>&1 && rustup target remove aarch64-unknown-linux-musl || true
else
    log "rustup and its aarch64-unknown-linux-musl target pre-existed (or state is unknown); leaving them alone"
fi

rm -rf "$STATE_DIR"

log "Done."
