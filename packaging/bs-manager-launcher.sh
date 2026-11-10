#!/usr/bin/env sh
# Launcher installed to ~/.local/bin/bs-manager by install.sh.
#
# Let Electron pick its platform; in the Frame's VR session that is X11 through XWayland
# (Steam starts desktop entries with DISPLAY=:0), the same way DaVarga's AppImage runs.
# Forcing --ozone-platform=wayland was wrong twice over: without WAYLAND_DISPLAY (Steam's
# "Launch program" list) Electron exited at once with "Failed to connect to Wayland display",
# which looked like the app not launching; and on gamescope's own socket (gamescope-0) the
# window appears, titled "Gamescope", but no controller pointer input ever reaches it.
exec "${HOME}/.local/opt/bs-manager/bs-manager" "$@"
