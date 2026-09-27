# BSManager for Steam Frame (ARM64)

This is a personal fork of [BSManager](https://github.com/Zagrios/bs-manager) — an
all-in-one tool for installing and managing modded Beat Saber — carrying the
ARM64/SteamOS fixes needed to run it on the **Steam Frame**, on top of current
upstream `master`.

## What this fork changes, and why

The Steam Frame runs SteamOS on ARM64, which BSManager's Linux support didn't
originally handle: it looks for Wine at `files/bin/wine64` (the x86_64 Proton
layout), and its Steam-shortcut/mod-install code makes a few assumptions that
don't hold on ARM64 Proton.

None of the fixes below originated in this repo. All of them are cherry-picked,
with original authorship preserved, from work already submitted upstream:

| Commit | What it does | Upstream status |
|---|---|---|
| `[fix] support ARM64 Proton Wine path` (jackwilsdon) | Recognizes `files/bin-arm64/wine`, the ARM64 Proton Wine binary path | **Merged** to `Zagrios/bs-manager` master ([#1118](https://github.com/Zagrios/bs-manager/pull/1118)) |
| `[fix] install BSIPA through Proton` (jackwilsdon) | Runs BSIPA's `IPA.exe` injector via `proton runinprefix` instead of raw Wine, so it actually runs on ARM64 Proton (which needs Proton's own env/wineserver setup, and Proton Experimental's ARM64 Mono) | Open — [#1122](https://github.com/Zagrios/bs-manager/pull/1122) |
| `[fix] detect Steam process on ARM64 Linux` (jackwilsdon) | ARM64 Steam's process name is `steamrtarm64/steam`, not `steam-runtime-launcher-service`; without this fix BSManager waits out a 60s timeout every launch | Open — [#1123](https://github.com/Zagrios/bs-manager/pull/1123) |
| `[fix] generate valid Linux Steam shortcuts` (jackwilsdon) | Fixes `LaunchOptions` generation so `%command%` and env vars (including `WINEDLLOVERRIDES`) are placed in the order Steam actually expects | Open — [#1124](https://github.com/Zagrios/bs-manager/pull/1124) |

**Credit:** the initial proof that this was possible at all came from
[thebillington](https://github.com/thebillington/bs-manager)'s fork and
[AUR packaging](https://github.com/thebillington/bs-manager-aur), written up
in [a Reddit tutorial](https://www.reddit.com/r/SteamFrame/comments/1wq1b9x/bsmanager_rebuilt_for_steam_frame_volunteers_for/)
for running BSManager on the Frame. That fork used a different technique for the
BSIPA problem (manually replicating `IPA.exe`'s file-drop install instead of
running it under Proton); this repo uses jackwilsdon's upstream-submitted
Proton-based approach instead, since it runs the real injector rather than a
hand-maintained re-implementation of its output, and it's already in review
against upstream. Full credit to both for the ARM64 groundwork.

This fork carries no BSManager code that isn't already public, upstream, and
CI-passing on `Zagrios/bs-manager` — it exists to make it installable *today*,
while PRs #1122–#1124 go through review.

## Building / installing

Requires SSH or terminal access to the Frame (enable Developer Mode and set an
SSH password under Settings → Developer Settings on the device first).

```sh
git clone <this-repo-url>
cd bs-manager-steam-frame
./install.sh
```

`install.sh`:

- Only targets `aarch64` Linux; refuses to run anywhere else.
- Installs Volta, a pinned Node 24, and pnpm (via Corepack, pinned to the
  version in `package.json`) if not already present.
- Installs `rustup` and the `aarch64-unknown-linux-musl` target if needed.
- Downloads Arch Linux ARM's `musl` package, **verifies its SHA256 against the
  checksum published in Arch Linux ARM's own repo database** (not just
  trusting the plain-HTTP download), then extracts and patches
  `musl-gcc.specs` for a user-local install path.
- Builds BSManager with `electron-builder`'s `dir` target (no `pacman`/
  `makepkg` machinery needed for a personal install).
- Installs everything under `~/.local` — binary, launcher, `.desktop` entry,
  and icons at every size BSManager ships — with no root and no changes
  outside your home directory.
- Is idempotent: safe to re-run after a `git pull` to rebuild, and fails
  loudly (with the failing command and line number) instead of continuing
  past a broken step.
- Cleans up after itself once the app is installed: `node_modules`, `dist/`,
  `release/`, and the Rust `target/` build directories are all removed from
  the checkout (they're multi-GB and no longer needed once the built app is
  copied into `~/.local`). Re-running `install.sh` later just rebuilds them.

A `packaging/PKGBUILD` is also included, kept in sync with the same source
tree, for anyone who'd rather build it the normal Arch/AUR way (e.g. once this
repo is public) instead of running `install.sh`.

### Uninstalling

```sh
./uninstall.sh
```

Removes the app, launcher, desktop entry, and icons, plus the musl
cross-toolchain and Corepack shims `install.sh` created — these are always
fully owned by this repo, so they're always removed. Volta and rustup are
only removed if `install.sh` installed them fresh in the first place (tracked
in `~/.local/share/bs-manager-steam-frame/install-state.env`); if either
already existed on your system before you ran `install.sh`, `uninstall.sh`
leaves it alone rather than guessing. Pass `-y`/`--yes` to skip the
confirmation prompt.

## Known caveat: mods only load when launched via BSManager, not via Steam directly

BSManager sets `WINEDLLOVERRIDES=winhttp=n,b` when it launches Beat Saber
itself — required so Wine loads the BSIPA-injected `winhttp.dll` instead of
its own built-in stub. Launching the same Steam shortcut directly from the
Steam client skips this, because (until [#1124](https://github.com/Zagrios/bs-manager/pull/1124)
merges) the `LaunchOptions` BSManager writes into existing Steam shortcuts
don't actually apply that env var — Steam only special-cases `VAR=value`
pairs that appear *before* a literal `%command%` token, and the shortcut this
fork's own commit fixes wasn't emitting one.

Until that lands upstream and you regenerate the shortcut, fix it by hand:
open Beat Saber's Properties in Steam → **Launch Options**, and set it to:

```
WINEDLLOVERRIDES="winhttp=n,b" %command%
```

If you re-create the Steam shortcut via BSManager *after* building from this
fork, the generated `LaunchOptions` already come out correct and you shouldn't
need this manual step.

## Config

On first launch, pick the default install location for game files, then point
BSManager at your Proton install, e.g.
`~/.local/share/Steam/steamapps/common/Proton - Experimental` (PR #1122 notes
Proton Experimental is required — 11.0 is missing ARM64 Mono).
