#!/bin/sh
# ci_post_clone.sh — Xcode Cloud hook
# ====================================
# Runs after Xcode Cloud clones the repo, BEFORE `xcodebuild` kicks in.
#
# LOCATION IS LOAD-BEARING. Xcode Cloud discovers `ci_scripts/` at the
# SAME LEVEL as the .xcodeproj / .xcworkspace file — NOT at the repo
# root. Our workspace is `ios/App/App.xcworkspace`, so this script must
# live at `ios/App/ci_scripts/ci_post_clone.sh`. Placing it at the
# repo root makes Xcode Cloud silently skip the hook.
#
# Why we need CocoaPods here:
#   - `ios/App/Pods` is gitignored (see `ios/.gitignore`). The Pods
#     directory is regenerated from `Podfile.lock` at build time.
#   - Xcode Cloud does NOT auto-run `pod install`.
#   - Xcode Cloud images used to ship CocoaPods pre-installed, but
#     current images (Xcode 15+) do NOT. Apple's own docs now say:
#     "Xcode Cloud includes the tools Homebrew, Ruby, and Ruby Gems;
#     the list of Ruby gems includes xcbeautify but not CocoaPods."
#     Reference:
#     https://developer.apple.com/documentation/xcode/making-dependencies-available-to-xcode-cloud
#
# Encoding note:
#   - We set `LANG=en_US.UTF-8` because CocoaPods has a known
#     ASCII-8BIT encoding bug on Ruby ≥ 4.0 that produces a cryptic
#     `Encoding::CompatibilityError`. Forcing UTF-8 avoids the issue
#     without pinning Ruby.
#
# Debuggability:
#   - We do NOT `set -e` at the top. `set -e` caused the previous
#     build to exit 1 with NO log output — the only visible signal was
#     "Running ci_post_clone.sh script failed (exited with code 1)".
#     Now we check each step's exit code explicitly and log context
#     before bailing, so any future failure is triage-able from the
#     Xcode Cloud log alone.

set -u  # unset-variable safety (good hygiene), but not -e.

log()  { echo "[ci_post_clone] $*"; }
fail() { echo "[ci_post_clone] ERROR: $*" >&2; exit 1; }

log "Olive iOS — post-clone hook starting"
log "Environment:"
log "  uname:    $(uname -a)"
log "  whoami:   $(whoami)"
log "  PATH:     $PATH"
log "  CI_PRIMARY_REPOSITORY_PATH=${CI_PRIMARY_REPOSITORY_PATH:-unset}"
log "  CI_WORKSPACE=${CI_WORKSPACE:-unset}"
log "  CI_WORKFLOW=${CI_WORKFLOW:-unset}"

export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# ── 1. Ensure CocoaPods is available ───────────────────────────────
# Current Xcode Cloud images do NOT preinstall CocoaPods. Install via
# Homebrew (which Xcode Cloud DOES preinstall). If `pod` is already on
# PATH (older image), skip install.
if command -v pod >/dev/null 2>&1; then
  log "CocoaPods found on PATH: $(command -v pod)"
else
  log "CocoaPods NOT on PATH — installing via Homebrew…"
  if ! command -v brew >/dev/null 2>&1; then
    fail "Neither 'pod' nor 'brew' is available. Xcode Cloud image is missing expected tooling; contact Apple support or pin an older Xcode version."
  fi
  if ! brew install cocoapods; then
    fail "brew install cocoapods failed — see log above for reason."
  fi
  log "CocoaPods installed via Homebrew: $(command -v pod)"
fi

log "CocoaPods version: $(pod --version 2>&1)"

# ── 2. cd to the ios/App directory ─────────────────────────────────
if [ -z "${CI_PRIMARY_REPOSITORY_PATH:-}" ]; then
  fail "CI_PRIMARY_REPOSITORY_PATH is unset. Xcode Cloud env contract violated."
fi

IOS_APP_DIR="${CI_PRIMARY_REPOSITORY_PATH}/ios/App"
if [ ! -d "$IOS_APP_DIR" ]; then
  fail "Expected iOS project at $IOS_APP_DIR but directory does not exist."
fi

cd "$IOS_APP_DIR" || fail "cd to $IOS_APP_DIR failed"
log "Working directory: $(pwd)"
log "Contents of $IOS_APP_DIR:"
ls -la | head -20 | sed 's/^/  /'

# ── 3. Sanity-check the Podfile target name matches pbxproj ────────
# If the Podfile target name drifts from the Xcode target name (as
# happened during the 'App' → 'withOlive' rename), `pod install` fails
# with "target 'X' not found in project". Surface this explicitly.
if [ ! -f Podfile ]; then
  fail "Podfile not found in $IOS_APP_DIR. Project layout changed?"
fi

PODFILE_TARGET=$(grep -E "^target '" Podfile | head -1 | sed -E "s/^target '([^']+)'.*/\\1/")
log "Podfile declares target: '${PODFILE_TARGET:-<none>}'"

# ── 4. pod install ─────────────────────────────────────────────────
log "Running 'pod install --repo-update'…"
if ! pod install --repo-update; then
  EC=$?
  log "pod install exited non-zero ($EC). Context:"
  log "---Podfile---"
  cat Podfile | sed 's/^/  /'
  log "---Podfile.lock (first 30 lines, if present)---"
  if [ -f Podfile.lock ]; then
    head -30 Podfile.lock | sed 's/^/  /'
  else
    log "  (no Podfile.lock — may be first install)"
  fi
  fail "pod install failed — see context above."
fi

# ── 5. Verify xcconfig files were generated ────────────────────────
TARGET_SUPPORT_DIR="Pods/Target Support Files/Pods-${PODFILE_TARGET}"
log "Checking $TARGET_SUPPORT_DIR/ for xcconfig files…"
if ls "$TARGET_SUPPORT_DIR"/*.xcconfig >/dev/null 2>&1; then
  log "xcconfig files generated:"
  ls -la "$TARGET_SUPPORT_DIR" | head -20 | sed 's/^/  /'
else
  fail "Expected xcconfig files in $TARGET_SUPPORT_DIR/ — none found. pod install reported success but didn't generate the expected artifacts."
fi

log "Done. Ready for xcodebuild."
