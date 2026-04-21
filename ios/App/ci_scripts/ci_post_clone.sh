#!/bin/sh
# ci_post_clone.sh — Xcode Cloud hook
# ====================================
# Runs after Xcode Cloud clones the repo, BEFORE `xcodebuild` kicks in.
#
# LOCATION IS LOAD-BEARING. Xcode Cloud discovers `ci_scripts/` at the
# SAME LEVEL as the .xcodeproj / .xcworkspace file — NOT at the repo
# root. Our workspace is `ios/App/App.xcworkspace`, so this script must
# live at `ios/App/ci_scripts/ci_post_clone.sh`. Placing it at the
# repo root makes Xcode Cloud silently skip the hook; the build then
# fails with "Unable to open base configuration reference file
# 'Pods-withOlive.release.xcconfig'" because `pod install` never ran.
# Apple docs:
#   https://developer.apple.com/documentation/xcode/writing-custom-build-scripts
#   https://developer.apple.com/documentation/xcode/making-dependencies-available-to-xcode-cloud
#
# Why we need this:
#   - `ios/App/Pods` is gitignored (see `ios/.gitignore`). The Pods
#     directory is regenerated from `Podfile.lock` at build time.
#   - Xcode Cloud does NOT auto-run `pod install`. Without this script,
#     the build fails with "Unable to open base configuration reference
#     file 'Pods-withOlive.release.xcconfig'" because the file doesn't
#     exist yet. The Xcode Cloud environment ships with CocoaPods
#     pre-installed, so we can invoke `pod install` directly.
#
# Environment notes:
#   - `CI_PRIMARY_REPOSITORY_PATH` is the repo root Xcode Cloud sets up.
#   - We set `LANG=en_US.UTF-8` because CocoaPods has a known
#     ASCII-8BIT encoding bug on Ruby ≥ 4.0 that produces a cryptic
#     `Encoding::CompatibilityError` when `pod install` parses the
#     Podfile path. Forcing UTF-8 avoids the issue without pinning Ruby.

set -eu

echo "[ci_post_clone] Olive iOS — post-clone hook"
echo "[ci_post_clone] CI_PRIMARY_REPOSITORY_PATH=${CI_PRIMARY_REPOSITORY_PATH:-unset}"

export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

cd "${CI_PRIMARY_REPOSITORY_PATH}/ios/App"

echo "[ci_post_clone] CocoaPods version: $(pod --version || echo 'NOT INSTALLED')"
echo "[ci_post_clone] Running pod install…"
pod install --repo-update --verbose

echo "[ci_post_clone] Pods directory after install:"
ls -la Pods/Target\ Support\ Files/Pods-withOlive/ 2>&1 || true

echo "[ci_post_clone] Done."
