#!/usr/bin/env sh
# Launcher installed to ~/.local/bin/bs-manager by install.sh.
exec "${HOME}/.local/opt/bs-manager/bs-manager" --ozone-platform=wayland "$@"
