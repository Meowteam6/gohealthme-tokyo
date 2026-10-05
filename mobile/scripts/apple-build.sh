#!/usr/bin/env bash
# Build the GoHealthMe iPhone app and upload it to TestFlight from this Mac.
# No Expo cloud account and no Apple ID signed into Xcode: signing and upload
# both use the App Store Connect API key (.p8) Nikki issues and Andre drops in
# mobile/.secrets/. Where the key comes from: docs/APPLE-LAUNCH-GATES.md.
# Run order and what Apple shows afterwards: scripts/README-build.md.
#
# Steps, in order:
#   1. load mobile/.env.submit   APPLE_TEAM_ID, APPLE_API_KEY_ID, APPLE_API_ISSUER_ID
#   2. expo prebuild --platform ios --clean   (ios/ from app.json; the HealthKit
#      plugin writes the entitlements)
#   3. pod install in ios/                    (explicit, retried with --repo-update)
#   4. xcodebuild archive                     (automatic signing driven by the key)
#   5. xcodebuild -exportArchive              (method app-store-connect)
#   6. xcrun altool --upload-app              (same key)
#
# Flags:
#   --skip-prebuild   reuse ios/ as it is; the archive and export are still redone
#   --skip-upload     stop once build/export/<App>.ipa exists
#   --upload-only     upload the .ipa already in build/export, no build at all
#
# Every run gets a fresh build number (UTC YYYYMMDDHHMM) so App Store Connect
# never refuses an upload as a duplicate. Nothing from .env.submit is printed.

set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"

usage() {
  sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'
}

skip_prebuild=0
skip_upload=0
upload_only=0
for arg in "$@"; do
  case "$arg" in
    --skip-prebuild) skip_prebuild=1 ;;
    --skip-upload) skip_upload=1 ;;
    --upload-only) upload_only=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }
step() { printf '\n== %s\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || die "$2"; }

build_dir="$here/build"
logs_dir="$build_dir/logs"
export_dir="$build_dir/export"

# Run a long command, mirror its output, keep the full log under build/logs.
run_logged() {
  local log="$logs_dir/$1.log"
  shift
  mkdir -p "$logs_dir"
  if ! "$@" 2>&1 | tee "$log"; then
    echo >&2
    die "step failed; full log at $log"
  fi
}

# ---------------------------------------------------------------- 1. env
step "1/6 signing material"

env_file="$here/.env.submit"
if [[ -f "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi

for var in APPLE_TEAM_ID APPLE_API_KEY_ID APPLE_API_ISSUER_ID; do
  [[ -n "${!var:-}" ]] || die "$var is unset. Add it to mobile/.env.submit (see docs/APPLE-LAUNCH-GATES.md)."
done
[[ "$APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] \
  || die "APPLE_TEAM_ID does not look like a Team ID (10 upper-case letters or digits). Check mobile/.env.submit."
[[ "$APPLE_API_KEY_ID" =~ ^[A-Z0-9]{10}$ ]] \
  || die "APPLE_API_KEY_ID does not look like a Key ID (10 upper-case letters or digits). Check mobile/.env.submit."
[[ "$APPLE_API_ISSUER_ID" =~ ^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$ ]] \
  || die "APPLE_API_ISSUER_ID does not look like an Issuer ID (a UUID). Check mobile/.env.submit."

secrets_dir="$here/.secrets"
key_path="$secrets_dir/AuthKey_${APPLE_API_KEY_ID}.p8"
[[ -f "$key_path" ]] \
  || die "API key missing. Expected mobile/.secrets/AuthKey_<APPLE_API_KEY_ID>.p8 (the .p8 Nikki sent, named after the Key ID)."
if [[ "$(stat -f '%Lp' "$key_path")" != "600" ]]; then
  chmod 600 "$key_path"
  echo "tightened the .p8 to mode 600"
fi
echo "team, key id, issuer id and .p8 present"

# Build settings every step shares.
auth_flags=(
  -authenticationKeyPath "$key_path"
  -authenticationKeyID "$APPLE_API_KEY_ID"
  -authenticationKeyIssuerID "$APPLE_API_ISSUER_ID"
)

need node "node is not on PATH (brew install node)"
app_name="$(node -p "require('./app.json').expo.name")"
marketing_version="$(node -p "require('./app.json').expo.version")"
bundle_id="$(node -p "require('./app.json').expo.ios.bundleIdentifier")"
build_number="$(date -u +%Y%m%d%H%M)"

# Without expo.icon, prebuild ships Expo's placeholder icon, a 1024x1024 PNG
# with an alpha channel, and App Store Connect refuses the upload (ITMS-90717).
# Catch that here, not after a fifteen-minute archive.
icon_path="$(node -p "const e=require('./app.json').expo; const i=(e.ios&&e.ios.icon)||e.icon||''; typeof i==='string'?i:(i.light||i.any||'')")"
[[ -n "$icon_path" ]] \
  || die "app.json has no expo.icon. Add a 1024x1024 PNG with no transparency, for example \"icon\": \"./assets/icon.png\". Expo's placeholder icon is refused by App Store Connect."
[[ -f "$icon_path" ]] || die "app.json icon $icon_path does not exist"

# The JS bundle inlines EXPO_PUBLIC_* at build time. Pin the deployment the
# app talks to so a stray shell variable cannot point TestFlight at a preview.
export EXPO_PUBLIC_API_BASE="${EXPO_PUBLIC_API_BASE:-https://gohealthme-tokyo.vercel.app}"
echo "app $app_name ($bundle_id) version $marketing_version build $build_number"
echo "api base $EXPO_PUBLIC_API_BASE"

# ---------------------------------------------------------------- upload-only
if (( upload_only )); then
  skip_prebuild=1
fi

# ---------------------------------------------------------------- 2. prebuild
if (( ! upload_only )); then
  step "2/6 expo prebuild"
  if (( skip_prebuild )); then
    [[ -d ios ]] || die "--skip-prebuild given but ios/ does not exist. Run once without it."
    echo "reusing ios/ (--skip-prebuild)"
  else
    rm -rf "$build_dir"
    [[ -d node_modules ]] || { echo "node_modules missing, running npm ci"; npm ci; }
    # expo prebuild rewrites package.json (it adds an android script). Snapshot
    # the manifests and put them back so a build never dirties tracked files.
    manifest_backup="$build_dir/manifests-before-prebuild"
    mkdir -p "$manifest_backup"
    cp package.json package-lock.json "$manifest_backup/"
    restore_manifests() {
      cp "$manifest_backup/package.json" package.json
      cp "$manifest_backup/package-lock.json" package-lock.json
    }
    trap restore_manifests EXIT
    # CI=1 keeps Expo from prompting (delete ios/, dirty git tree). --no-install
    # leaves pod install to the explicit step below so it runs once.
    run_logged prebuild env CI=1 npx expo prebuild --platform ios --clean --no-install
    restore_manifests
    trap - EXIT
  fi

  # ---------------------------------------------------------------- 3. pods
  step "3/6 pod install"
  need pod "CocoaPods is not on PATH (brew install cocoapods)"
  if ! (cd ios && pod install); then
    echo "pod install failed, retrying with --repo-update" >&2
    (cd ios && pod install --repo-update) || die "pod install failed twice; read the CocoaPods error above"
  fi
  # The Xcode bundling phase needs node. Resolve it now so xcodebuild's minimal
  # environment does not have to find it.
  printf 'export NODE_BINARY=%q\n' "$(command -v node)" > ios/.xcode.env.local
fi

if (( ! upload_only )); then
  # -------------------------------------------------------------- names
  # Expo names the project after app.json expo.name with every non-word
  # character removed (sanitizedName in @expo/config-plugins); CocoaPods then
  # writes the .xcworkspace beside it. Read what actually landed instead of
  # trusting that.
  workspace="$(find ios -maxdepth 1 -name '*.xcworkspace' -print 2>/dev/null | head -n 1)"
  [[ -n "$workspace" ]] || die "no .xcworkspace under ios/. prebuild or pod install did not finish."
  scheme="$(basename "$workspace" .xcworkspace)"
  if command -v jq >/dev/null 2>&1; then
    schemes="$(xcodebuild -list -workspace "$workspace" -json 2>/dev/null | jq -r '.workspace.schemes[]?' || true)"
    if [[ -n "$schemes" ]] && ! grep -qx "$scheme" <<<"$schemes"; then
      scheme="$(grep -v '^Pods' <<<"$schemes" | head -n 1)"
    fi
  fi
  [[ -n "$scheme" ]] || die "could not pick a scheme from $workspace"
  archive_path="$build_dir/$scheme.xcarchive"
  echo "workspace $workspace, scheme $scheme"

  # Expo writes the version and build number into Info.plist as literal values
  # (verified on SDK 54: CFBundleShortVersionString 0.2.0, CFBundleVersion 1),
  # so MARKETING_VERSION and CURRENT_PROJECT_VERSION on the xcodebuild line
  # never reach the app on their own. Set the plist directly before every
  # archive; the check after the archive proves it landed.
  info_plist="ios/$scheme/Info.plist"
  [[ -f "$info_plist" ]] || info_plist="$(find ios -maxdepth 2 -name Info.plist -not -path '*/Pods/*' -not -path '*/build/*' | head -n 1)"
  [[ -f "$info_plist" ]] || die "cannot find the app's Info.plist under ios/"
  /usr/libexec/PlistBuddy \
    -c "Set :CFBundleShortVersionString $marketing_version" \
    -c "Set :CFBundleVersion $build_number" \
    "$info_plist"
  echo "set $info_plist to $marketing_version ($build_number)"

  # -------------------------------------------------------------- 4. archive
  step "4/6 xcodebuild archive"
  rm -rf "$archive_path" "$export_dir"
  mkdir -p "$build_dir"
  run_logged archive xcodebuild \
    -workspace "$workspace" \
    -scheme "$scheme" \
    -configuration Release \
    -sdk iphoneos \
    -destination 'generic/platform=iOS' \
    -archivePath "$archive_path" \
    archive \
    -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration \
    "${auth_flags[@]}" \
    DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
    CODE_SIGN_STYLE=Automatic \
    CURRENT_PROJECT_VERSION="$build_number" \
    MARKETING_VERSION="$marketing_version" \
    -quiet

  # Prove the archive carries what we asked for before spending time on export.
  app_bundle="$(find "$archive_path/Products/Applications" -maxdepth 1 -name '*.app' | head -n 1)"
  [[ -n "$app_bundle" ]] || die "archive has no .app under Products/Applications"
  plist="$app_bundle/Info.plist"
  got_bundle="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")"
  got_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")"
  got_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist")"
  [[ "$got_bundle" == "$bundle_id" ]] || die "archive bundle id is $got_bundle, app.json says $bundle_id"
  [[ "$got_version" == "$marketing_version" ]] || die "archive version is $got_version, expected $marketing_version (Info.plist not wired to MARKETING_VERSION)"
  [[ "$got_build" == "$build_number" ]] || die "archive build is $got_build, expected $build_number (Info.plist not wired to CURRENT_PROJECT_VERSION)"
  if ! codesign -d --entitlements - --xml "$app_bundle" 2>/dev/null | grep -q 'com.apple.developer.healthkit'; then
    die "the archived app has no HealthKit entitlement; the @kingstinct/react-native-healthkit plugin did not apply. Check app.json plugins."
  fi
  echo "archive ok: $got_bundle $got_version ($got_build), HealthKit entitlement present"

  # ---------------------------------------------------------------- 5. export
  step "5/6 xcodebuild -exportArchive"
  export_plist="$build_dir/ExportOptions.plist"
  cat > "$export_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>export</string>
  <key>teamID</key>
  <string>${APPLE_TEAM_ID}</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>uploadSymbols</key>
  <true/>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
</dict>
</plist>
EOF
  run_logged export xcodebuild \
    -exportArchive \
    -archivePath "$archive_path" \
    -exportOptionsPlist "$export_plist" \
    -exportPath "$export_dir" \
    -allowProvisioningUpdates \
    "${auth_flags[@]}" \
    -quiet
fi

ipa="$(find "$export_dir" -maxdepth 1 -name '*.ipa' 2>/dev/null | head -n 1)"
[[ -n "$ipa" ]] || die "no .ipa in build/export. Run without --upload-only."
echo "ipa $ipa"

if (( skip_upload )); then
  step "done (--skip-upload)"
  echo "Upload later with: scripts/apple-build.sh --upload-only"
  exit 0
fi

# ---------------------------------------------------------------- 6. upload
step "6/6 xcrun altool --upload-app"
# altool searches for AuthKey_<KEY_ID>.p8 in ./private_keys, ~/private_keys,
# ~/.private_keys, ~/.appstoreconnect/private_keys or $API_PRIVATE_KEYS_DIR.
# Pointing it at mobile/.secrets keeps the key in one place; nothing is copied.
export API_PRIVATE_KEYS_DIR="$secrets_dir"
run_logged upload xcrun altool --upload-app \
  -f "$ipa" \
  -t ios \
  --apiKey "$APPLE_API_KEY_ID" \
  --apiIssuer "$APPLE_API_ISSUER_ID"

step "uploaded $app_name $marketing_version ($build_number)"
cat <<'EOF'
Processing takes 5-20 min; then App Store Connect > TestFlight > add the internal group.
Apple emails the account when the build is ready. If it says "Missing Compliance",
app.json already sets ITSAppUsesNonExemptEncryption=false; re-run prebuild.
EOF
