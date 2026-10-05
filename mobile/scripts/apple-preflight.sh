#!/usr/bin/env bash
# Can this Mac build and upload the GoHealthMe iPhone app right now?
# Checks the toolchain and the signing material scripts/apple-build.sh needs,
# prints a pass/fail table, exits 1 on any fail. Never prints a value from
# mobile/.env.submit or the contents of the .p8.
#
# Usage: scripts/apple-preflight.sh

set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"

fails=0
rows=()

record() { # record <PASS|FAIL> <what> <fix when failing>
  local status="$1" what="$2" fix="${3:-}"
  if [[ "$status" == "FAIL" ]]; then
    fails=$((fails + 1))
    rows+=("$(printf '%-4s  %-44s  %s' "$status" "$what" "$fix")")
  else
    rows+=("$(printf '%-4s  %-44s' "$status" "$what")")
  fi
}

check() { # check <what> <fix> <command...>; passes when the command exits 0
  local what="$1" fix="$2"
  shift 2
  if "$@" >/dev/null 2>&1; then
    record PASS "$what"
  else
    record FAIL "$what" "$fix"
  fi
}

# ---------------------------------------------------------------- toolchain
xcode_path="$(xcode-select -p 2>/dev/null || true)"
if [[ -n "$xcode_path" && "$xcode_path" == *"/Xcode"*".app/"* && -x "$xcode_path/usr/bin/xcodebuild" ]]; then
  record PASS "Xcode selected ($xcode_path)"
else
  record FAIL "Xcode selected" "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
fi

check "Xcode first-launch tasks done" \
  "sudo xcodebuild -runFirstLaunch" \
  xcodebuild -checkFirstLaunchStatus

if xcodebuild -showsdks 2>/dev/null | grep -q -- '-sdk iphoneos'; then
  record PASS "iphoneos SDK present"
else
  record FAIL "iphoneos SDK present" "Xcode > Settings > Components, install the iOS platform"
fi

check "node on PATH" "brew install node" command -v node
check "npm on PATH" "brew install node" command -v npm

if [[ -d node_modules ]] && npx --no-install expo --version >/dev/null 2>&1; then
  record PASS "expo CLI in node_modules"
else
  record FAIL "expo CLI in node_modules" "cd mobile && npm ci"
fi

# Expo's placeholder app icon has an alpha channel; App Store Connect refuses
# it (ITMS-90717). The build needs a real icon in app.json.
icon_path="$(node -p "const e=require('./app.json').expo; const i=(e.ios&&e.ios.icon)||e.icon||''; typeof i==='string'?i:(i.light||i.any||'')" 2>/dev/null || true)"
if [[ -n "$icon_path" && -f "$icon_path" ]]; then
  record PASS "app.json icon present ($icon_path)"
else
  record FAIL "app.json icon present" "add \"icon\": \"./assets/icon.png\" (1024x1024 PNG, no transparency) to app.json"
fi

check "CocoaPods (pod) on PATH" "brew install cocoapods" command -v pod
check "altool via xcrun" "install Xcode, then xcode-select (above)" xcrun --find altool
check "PlistBuddy present" "part of macOS; reinstall Command Line Tools" test -x /usr/libexec/PlistBuddy

# ---------------------------------------------------------------- signing material
env_file="$here/.env.submit"
if [[ -f "$env_file" ]]; then
  record PASS "mobile/.env.submit present"
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
else
  record FAIL "mobile/.env.submit present" "create it with the three APPLE_* lines (docs/APPLE-LAUNCH-GATES.md)"
fi

if [[ -n "${APPLE_TEAM_ID:-}" ]]; then
  if [[ "$APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]; then
    record PASS "APPLE_TEAM_ID set and shaped like a Team ID"
  else
    record FAIL "APPLE_TEAM_ID shaped like a Team ID" "10 upper-case letters or digits, from Membership details"
  fi
else
  record FAIL "APPLE_TEAM_ID set" "add APPLE_TEAM_ID=... to mobile/.env.submit"
fi

if [[ -n "${APPLE_API_KEY_ID:-}" ]]; then
  if [[ "$APPLE_API_KEY_ID" =~ ^[A-Z0-9]{10}$ ]]; then
    record PASS "APPLE_API_KEY_ID set and shaped like a Key ID"
  else
    record FAIL "APPLE_API_KEY_ID shaped like a Key ID" "10 upper-case letters or digits, from the API key row"
  fi
else
  record FAIL "APPLE_API_KEY_ID set" "add APPLE_API_KEY_ID=... to mobile/.env.submit"
fi

if [[ -n "${APPLE_API_ISSUER_ID:-}" ]]; then
  if [[ "$APPLE_API_ISSUER_ID" =~ ^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$ ]]; then
    record PASS "APPLE_API_ISSUER_ID set and shaped like a UUID"
  else
    record FAIL "APPLE_API_ISSUER_ID shaped like a UUID" "copy the Issuer ID from the App Store Connect API page"
  fi
else
  record FAIL "APPLE_API_ISSUER_ID set" "add APPLE_API_ISSUER_ID=... to mobile/.env.submit"
fi

if [[ -n "${APPLE_API_KEY_ID:-}" ]]; then
  key_path="$here/.secrets/AuthKey_${APPLE_API_KEY_ID}.p8"
  if [[ -f "$key_path" ]]; then
    record PASS ".p8 at mobile/.secrets/AuthKey_<KEY_ID>.p8"
    if head -n 1 "$key_path" | grep -q '^-----BEGIN PRIVATE KEY-----$'; then
      record PASS ".p8 is a PEM private key"
    else
      record FAIL ".p8 is a PEM private key" "the file should start with -----BEGIN PRIVATE KEY-----; re-download from Nikki"
    fi
    if [[ "$(stat -f '%Lp' "$key_path")" == "600" ]]; then
      record PASS ".p8 mode 600"
    else
      record FAIL ".p8 mode 600" "chmod 600 mobile/.secrets/AuthKey_<KEY_ID>.p8"
    fi
  else
    record FAIL ".p8 at mobile/.secrets/AuthKey_<KEY_ID>.p8" "drop the .p8 there, named AuthKey_ plus the Key ID"
  fi
else
  record FAIL ".p8 location known" "needs APPLE_API_KEY_ID first"
fi

# ---------------------------------------------------------------- report
printf '%-4s  %-44s  %s\n' "RES" "CHECK" "FIX"
printf '%-4s  %-44s  %s\n' "----" "--------------------------------------------" "---"
for row in "${rows[@]}"; do
  echo "$row"
done
echo
if (( fails > 0 )); then
  echo "$fails check(s) failed. Fix them, then run scripts/apple-build.sh."
  exit 1
fi
echo "all checks passed. Next: scripts/apple-build.sh"
