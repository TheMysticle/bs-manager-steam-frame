# BSManager for Steam Frame (ARM64)

This is a personal fork of [BSManager](https://github.com/Zagrios/bs-manager) — an
all-in-one tool for installing and managing modded Beat Saber — carrying the
ARM64/SteamOS fixes needed to run it on the **Steam Frame**, on top of current
upstream `master`. It also adds an **ARM64 tab** that installs a native ARM64 build of Beat
Saber ([bs-arm64](https://github.com/TheMysticle/bs-arm64)) for supported versions, and an
**experimental branch** with a hand-maintained mod list for Beat Saber 1.45.1, which BeatMods
doesn't support yet.

> [!NOTE]
> **[How to install on the Steam Frame](docs/steam-frame.md)**
>
> Unofficial; the original project is [Zagrios/bs-manager](https://github.com/Zagrios/bs-manager).

<!-- PROJECT SHIELDS -->
<!--
*** I'm using markdown "reference style" links for readability.
*** Reference links are enclosed in brackets [ ] instead of parentheses ( ).
*** See the bottom of this document for the declaration of the reference variables
*** for contributors-url, forks-url, etc. This is an optional, concise syntax you may use.
*** https://www.markdownguide.org/basic-syntax/#reference-style-links
-->

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
CI-passing on `Zagrios/bs-manager` — it's a stopgap, existing purely to make
BSManager installable on the Frame *today* while PRs #1122–#1124 go through
review. Once they land upstream, this whole repo stops being necessary and
you should just use upstream BSManager directly.

In the meantime, to save people the build step entirely, I'm planning to
publish prebuilt aarch64 binaries under Releases along with a small script to
set up the Steam shortcut.

## The ARM64 tab and native ARM64 build: credit and changes

The **ARM64 tab** feature itself — the UI, the install/uninstall flow, release
matching against your Proton build, SHA-256 verification, re-applying the
ARM64 mod-loader fixes after a BSIPA install, and foveated-rendering
passthrough — is [Daniel Varga (DaVarga)](https://github.com/DaVarga)'s work,
merged in from [DaVarga/bs-manager](https://github.com/DaVarga/bs-manager)
(`[feat] install the native ARM64 build (bs-arm64) from a new ARM64 tab`,
`[feat] turn on bs-arm64 foveated rendering...`). The native runtime it
installs, [bs-arm64](https://github.com/DaVarga/bs-arm64), is also entirely
his: reverse-engineering what it takes to run Beat Saber as genuine native
ARM64 Windows code under Proton instead of x64-via-FEX, and building every
native replacement component that takes (Steamworks, lsteamclient,
wineopenxr, DXVK, the BSIPA Doorstop, all rebuilt for ARM64). None of that
original engineering is changed here.

What changed after merging it into this fork:

- **[TheMysticle/bs-arm64](https://github.com/TheMysticle/bs-arm64)**: a fork
  of DaVarga's runtime, ported from Beat Saber 1.44.1 (Unity 6000.0.40f1) to
  **1.45.1** (Unity 6000.3.19f1) — see that repo's README for exactly what the
  port changed. The ARM64 tab here now points at this fork's releases and
  version list instead of DaVarga's 1.44.1-only ones.
- Fixed a real bug in the actual "Play" launch path: `SteamLauncherService`
  had its own separate Proton-selection call that never checked whether the
  target instance was native-ARM64-patched, so clicking Play on one would
  always use BSManager's main Proton setting and fail — regardless of the
  ARM64 tab's own Proton-mismatch bookkeeping. Fixed as part of adding the
  dedicated Proton setting below.
- Added a second, dedicated **Native ARM64 Proton folder** setting (see
  **Native ARM64 build** below) so BSManager's main Proton (for BSIPA) and
  the Proton a native ARM64 instance needs can differ without manually
  swapping one setting back and forth.
- Fixed a regression the merge itself could have introduced in Steam-process
  detection (`steam.service.ts`): combined DaVarga's dual process-name array
  (needed because the ARM64 Steam client's process name differs from x86_64)
  with this fork's existing trailing-space fix (avoiding a false match
  against `steamwebhelper`), since the two changes touched the same lines
  independently.
- The ARM64 tab only ever installs into a BSManager-tracked instance, never
  your actual Steam-installed copy directly — that's unchanged from DaVarga's
  design. What's new is the **Steam Launch Options** path below, for
  launching those already-patched files directly from your Steam library
  instead of through BSManager, plus documenting exactly which Proton build
  and env vars that requires.

## A note on how this was made

I'm not a professional programmer. I do some Android development, but this
area is new to me, so I know just enough to spot when something has gone wrong
and roughly how to fix it.

Much of the code here was written with AI assistance. I direct the work,
review what it produces, and test everything on real hardware before it goes
into a release. I'm sharing this because I'd rather be upfront about it than
have you wonder.

I understand not everyone is comfortable with AI-assisted code, and that's a
fair position; a lot of people here have spent years building real expertise.
If you'd rather check things yourself, everything is open and the commits are
small. Bug reports, reviews and corrections are very welcome, and I'll fix
what I get wrong.

## Building / installing

Requires SSH or terminal access to the Frame (enable Developer Mode and set an
SSH password under Settings → Developer Settings on the device first).

**Clone this repo with `git` directly on the Frame itself** — don't copy the
files over from another machine (e.g. via `scp`/rsync/a tarball). `install.sh`
expects a real git checkout: it uses `git` to detect and repair a build left
in a broken state by an earlier crashed/interrupted run, which it can't do
without the repo's `.git` history actually being there.

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

## Native ARM64 build (the ARM64 tab / bs-arm64) — Steam Launch Options are required

> [!IMPORTANT]
> **If you want to launch the native ARM64 build ([bs-arm64](https://github.com/TheMysticle/bs-arm64))
> directly from your Steam library instead of through BSManager, you must add
> these environment variables to Beat Saber's Steam Launch Options.** They are
> not optional convenience settings — without them the native build will not
> start correctly (missing Steam/OpenXR integration, or a Vulkan device-creation
> hang). Right-click Beat Saber in Steam → **Properties → General → Launch
> Options**, and set it to exactly:
>
> ```
> WINEDLLPATH="$STEAM_COMPAT_DATA_PATH/pfx/drive_c/bs-arm64" WINEDLLOVERRIDES="winhttp=n,b" DISABLE_VULKAN_FDM_INJECTION_LAYER=1 %command%
> ```
>
> - `WINEDLLPATH` points Wine at the ARM64 builtins (`lsteamclient_a64.dll`,
>   `wineopenxr_a64.dll`) that bs-arm64 installs into the prefix.
> - `WINEDLLOVERRIDES="winhttp=n,b"` is the same mod-loader override as above.
> - `DISABLE_VULKAN_FDM_INJECTION_LAYER=1` works around a real bug: Valve's
>   foveated-rendering injection layer spins forever in `vkCreateDevice` under
>   Proton ARM64 without it.

> [!IMPORTANT]
> **You must also set Beat Saber's own Proton version (Properties →
> Compatibility → force the use of a specific Steam Play compatibility tool)
> to the exact Proton build bs-arm64 was installed against — currently
> "Proton 11.0 (ARM64)".** bs-arm64's native Wine builtins are compiled
> against one specific Proton build; using a different one (including "Proton
> Experimental (ARM64)") will not work, and bs-arm64's own tooling will refuse
> to launch if it detects a mismatch. This is a **separate setting from
> BSManager's own Proton install setting below** — they don't need to match,
> and changing one doesn't affect the other.

BSManager itself has a dedicated **"Native ARM64 Proton folder"** setting
(Settings, right below the main Proton folder) for exactly this: point it at
the same Proton build bs-arm64 was installed against, and BSManager's own
"Play" button (and any Steam shortcut it generates) will detect a
bs-arm64-patched instance and launch it with that Proton automatically,
instead of the main Proton folder setting. This is a **separate setting from
BSManager's main Proton folder** (used to patch/launch regular instances,
still Proton Experimental for BSIPA - see **Config** below); the two don't
need to match, and BSManager picks whichever one applies per instance.

This means, once both Proton folders are configured, BSManager's "Play"
button works directly on an ARM64-patched instance without a Proton-mismatch
error. Launching from your **Steam library** with the manual Launch Options
above is still required if you want to start the game from Steam directly
without going through BSManager at all (e.g. via Steam Input, a Steam
shortcut/tile, or VR dashboard) - Steam has no way to know about BSManager's
per-instance Proton selection.

## Config

On first launch, pick the default install location for game files, then point
BSManager at your Proton install, e.g.
`~/.local/share/Steam/steamapps/common/Proton - Experimental`.

If you plan to use the native ARM64 build, also set **Native ARM64 Proton
folder** in Settings (right below the Proton folder above) to the exact
Proton build bs-arm64 was installed against, e.g.
`~/.local/share/Steam/steamapps/common/Proton 11.0 (ARM64)` — see **Native
ARM64 build** above for why this needs to be a separate setting.

> [!WARNING]
> **You must set this to Proton Experimental, not any other Proton version.**
> Proton 11.0 is missing the ARM64 Mono runtime that BSIPA's installer needs
> (see PR #1122) — pointing BSManager at anything other than Proton
> Experimental will make **BSIPA (IPA) installation fail**.
>
> This fork later merged in a workaround from [DaVarga/bs-manager](https://github.com/DaVarga/bs-manager)
> (`getRunnableIpaPath` in `bs-mods-manager.service.ts`) that runs `IPA.exe`
> forced to x86 (via FEX) instead of relying on
> ARM64-native wine-mono, which in principle should make Proton 11.0 work for
> this too — but that hasn't been verified end-to-end yet. Until it is,
> **Proton Experimental (ARM64) remains the known-working, recommended
> setting for BSManager's own Proton install**, independent of whatever
> Proton you set for Beat Saber itself in Steam (see the native ARM64 section
> above) — these are two separate settings and don't need to match.
