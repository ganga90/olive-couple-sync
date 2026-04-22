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

# ── 2. Ensure node_modules exists (Capacitor Podfile requires it) ──
# The Capacitor-generated Podfile's first line is:
#   require_relative '../../node_modules/@capacitor/ios/scripts/pods_helpers'
# That Ruby file lives INSIDE node_modules/@capacitor/ios/. Without
# `npm install`, pod install fails with:
#   [!] Invalid `Podfile` file: cannot load such file
#   -- /Volumes/workspace/repository/node_modules/@capacitor/ios/scripts/pods_helpers
# Reference: https://capacitorjs.com/docs/ios — Capacitor Pods load
# helpers from the node_modules location, not CocoaPods' own spec repo.
#
# Xcode Cloud images don't preinstall Node, so install via Homebrew on
# first run. Then run `npm ci` (strict, lockfile-based — faster and
# more reproducible than `npm install`; falls back to `npm install` if
# ci fails due to a lockfile drift).

if [ -z "${CI_PRIMARY_REPOSITORY_PATH:-}" ]; then
  fail "CI_PRIMARY_REPOSITORY_PATH is unset. Xcode Cloud env contract violated."
fi

if command -v npm >/dev/null 2>&1; then
  log "Node/npm found on PATH: $(command -v node) / $(command -v npm)"
else
  log "Node NOT on PATH — installing via Homebrew…"
  if ! command -v brew >/dev/null 2>&1; then
    fail "Neither 'npm' nor 'brew' is available. Cannot install Node.js."
  fi
  if ! brew install node; then
    fail "brew install node failed — see log above for reason."
  fi
  log "Node installed via Homebrew: $(command -v node)"
fi

log "Node version: $(node --version 2>&1), npm version: $(npm --version 2>&1)"

cd "$CI_PRIMARY_REPOSITORY_PATH" || fail "cd to $CI_PRIMARY_REPOSITORY_PATH failed"
log "At repo root: $(pwd)"

if [ ! -f package.json ]; then
  fail "package.json not found at repo root — Capacitor Podfile cannot resolve node_modules path."
fi

log "Running 'npm ci' to populate node_modules…"
if ! npm ci --no-audit --no-fund --prefer-offline; then
  log "npm ci failed — falling back to 'npm install' (lockfile may have drifted)"
  if ! npm install --no-audit --no-fund; then
    fail "Both 'npm ci' and 'npm install' failed. Cannot populate node_modules."
  fi
fi

# Sanity-check the specific Capacitor helper path the Podfile
# require_relative-s. If this is missing, pod install will still fail
# even with node_modules populated.
CAPACITOR_HELPERS="${CI_PRIMARY_REPOSITORY_PATH}/node_modules/@capacitor/ios/scripts/pods_helpers.rb"
if [ ! -f "$CAPACITOR_HELPERS" ]; then
  log "WARNING: Capacitor helpers not found at $CAPACITOR_HELPERS after npm install."
  log "Contents of node_modules/@capacitor/ios/scripts/ (if dir exists):"
  ls -la "${CI_PRIMARY_REPOSITORY_PATH}/node_modules/@capacitor/ios/scripts/" 2>&1 | sed 's/^/  /' || true
  fail "Capacitor pods_helpers is missing. Check @capacitor/ios version in package.json."
fi
log "Capacitor pods_helpers present: $CAPACITOR_HELPERS"

# ── 3. Build the web app + sync into the native iOS project ────────
# The Capacitor iOS target bundles `ios/App/App/public/` (the built web
# app) and `ios/App/App/config.xml` (regenerated from capacitor.config.ts).
# BOTH are gitignored (see `ios/.gitignore`) and regenerated on every
# build. Without this step, xcodebuild fails with:
#   error: The file "public" couldn't be opened because there is no such file.
#   error: The file "config.xml" couldn't be opened because there is no such file.
#
# Sequence:
#   1. `npm run build` — Vite produces `dist/` at the repo root (this
#      is what `webDir` in capacitor.config.ts points to).
#   2. `npx cap copy ios` — copies `dist/` → `ios/App/App/public/` and
#      regenerates `capacitor.config.json` inside the iOS bundle.
#   3. `npx cap update ios` — updates the iOS native project's plugin
#      refs and writes `config.xml`.
# Both `cap copy` and `cap update` are idempotent; neither runs
# `pod install` (that's `cap sync`'s job, and we handle pod install
# explicitly in section 5 so we can dump Podfile context on failure).

log "Running 'npm run build' (Vite → dist/)…"
if ! npm run build; then
  fail "'npm run build' failed — see log above. Check vite.config.ts / package.json build script."
fi

if [ ! -f "${CI_PRIMARY_REPOSITORY_PATH}/dist/index.html" ]; then
  fail "Expected dist/index.html after 'npm run build' — not found. Build silently produced no output?"
fi
log "Build output present: $(ls -la "${CI_PRIMARY_REPOSITORY_PATH}/dist" | wc -l | xargs) entries in dist/"

log "Running 'npx cap copy ios' (dist/ → ios/App/App/public/)…"
if ! npx cap copy ios; then
  fail "'npx cap copy ios' failed. Capacitor config or webDir mismatch?"
fi

log "Running 'npx cap update ios' (plugin refs + config.xml)…"
if ! npx cap update ios; then
  fail "'npx cap update ios' failed. Check native plugin install state."
fi

# Verify the two files xcodebuild actually errored on last time.
if [ ! -d "${CI_PRIMARY_REPOSITORY_PATH}/ios/App/App/public" ]; then
  fail "ios/App/App/public/ still missing after cap copy — xcodebuild will fail to find web assets."
fi
if [ ! -f "${CI_PRIMARY_REPOSITORY_PATH}/ios/App/App/config.xml" ]; then
  fail "ios/App/App/config.xml still missing after cap update — xcodebuild will fail."
fi
log "ios/App/App/public/ and config.xml present ✓"

# ── 4. cd to the ios/App directory for pod install ────────────────
IOS_APP_DIR="${CI_PRIMARY_REPOSITORY_PATH}/ios/App"
if [ ! -d "$IOS_APP_DIR" ]; then
  fail "Expected iOS project at $IOS_APP_DIR but directory does not exist."
fi

cd "$IOS_APP_DIR" || fail "cd to $IOS_APP_DIR failed"
log "Working directory: $(pwd)"
log "Contents of $IOS_APP_DIR:"
ls -la | head -20 | sed 's/^/  /'

# ── 5. Sanity-check the Podfile target name matches pbxproj ────────
# If the Podfile target name drifts from the Xcode target name (as
# happened during the 'App' → 'withOlive' rename), `pod install` fails
# with "target 'X' not found in project". Surface this explicitly.
if [ ! -f Podfile ]; then
  fail "Podfile not found in $IOS_APP_DIR. Project layout changed?"
fi

PODFILE_TARGET=$(grep -E "^target '" Podfile | head -1 | sed -E "s/^target '([^']+)'.*/\\1/")
log "Podfile declares target: '${PODFILE_TARGET:-<none>}'"

# ── 6. pod install ─────────────────────────────────────────────────
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

# ── 7. Verify xcconfig files were generated ────────────────────────
TARGET_SUPPORT_DIR="Pods/Target Support Files/Pods-${PODFILE_TARGET}"
log "Checking $TARGET_SUPPORT_DIR/ for xcconfig files…"
if ls "$TARGET_SUPPORT_DIR"/*.xcconfig >/dev/null 2>&1; then
  log "xcconfig files generated:"
  ls -la "$TARGET_SUPPORT_DIR" | head -20 | sed 's/^/  /'
else
  fail "Expected xcconfig files in $TARGET_SUPPORT_DIR/ — none found. pod install reported success but didn't generate the expected artifacts."
fi

log "Done. Ready for xcodebuild."
