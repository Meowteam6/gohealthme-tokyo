# Building and shipping the iPhone app to TestFlight

Everything runs on this Mac. No Expo cloud account, no Apple ID signed into
Xcode. Signing and upload both use the App Store Connect API key from
`docs/APPLE-LAUNCH-GATES.md`.

## Once, before the first run

1. Nikki: invite Andre to the team (Admin), generate the API key (App Manager),
   send the `.p8`, Key ID and Issuer ID, plus the Team ID.
2. Andre: drop the key at `mobile/.secrets/AuthKey_<KEY_ID>.p8` and write
   `mobile/.env.submit` with three lines, values only:

   ```
   APPLE_TEAM_ID=
   APPLE_API_KEY_ID=
   APPLE_API_ISSUER_ID=
   ```

   Both paths are git-ignored. Nothing else in this repo holds the key.
3. Andre, in App Store Connect > Apps > plus > New App: platform iOS, name
   GoHealthMe, bundle ID `com.chuabiolabs.gohealthme`, SKU anything. The
   upload step refuses an `.ipa` with no app record to land in. If the bundle
   ID is not offered in that dropdown yet, run the build once first: the
   archive step registers it on the developer portal, then create the record
   and run `scripts/apple-build.sh --upload-only`.
4. An app icon in `app.json`: `"icon": "./assets/icon.png"`, a 1024x1024 PNG
   with no transparency. Without it Expo ships its placeholder, which carries
   an alpha channel, and App Store Connect refuses the build (ITMS-90717).
   Both scripts stop on a missing icon before any build time is spent.

## Run order

```bash
cd mobile
scripts/apple-preflight.sh     # pass/fail table; fix every FAIL before moving on
scripts/apple-build.sh         # prebuild, pods, archive, export, upload
```

Expect 10 to 20 minutes on the first run (CocoaPods and a cold Xcode build).
Each step prints a `== n/6` line, and full logs land in `mobile/build/logs/`.

What the build script decides for you:

- **Version**: `expo.version` from `app.json` becomes `MARKETING_VERSION`.
- **Build number**: UTC time as `YYYYMMDDHHMM`, so every upload is unique and
  App Store Connect never rejects a duplicate. Xcode's own build-number
  management is switched off in the export options so it cannot overwrite it.
  Expo writes version and build into `ios/GoHealthMe/Info.plist` as literal
  values, so the script sets both there with PlistBuddy before each archive
  and then reads them back out of the archive to prove they landed.
- **Tracked files stay clean**: `expo prebuild` rewrites `package.json` (it
  adds an `android` script); the script snapshots and restores it.
- **Deployment the app talks to**: `EXPO_PUBLIC_API_BASE`, defaulting to
  `https://gohealthme-tokyo.vercel.app`. Never the V3 pilot.
- **Workspace and scheme**: read from what `expo prebuild` writes
  (`ios/GoHealthMe.xcworkspace`, scheme `GoHealthMe`), not hard-coded.
- **Checks before export**: the archive's bundle ID, version and build match
  what was asked for, and the HealthKit entitlement is present. A miss stops
  the run before any upload.

Flags:

| Flag | Use it when |
|---|---|
| `--skip-upload` | you want the `.ipa` in `build/export/` but not on TestFlight yet |
| `--skip-prebuild` | `ios/` is already generated and nothing in `app.json` or the plugins changed; saves about two minutes |
| `--upload-only` | the build succeeded and only the upload failed (network, missing app record); re-sends `build/export/*.ipa` |

Without `--skip-prebuild` the script wipes `mobile/build/` and `mobile/ios/`
first, so a plain re-run is always a clean build.

## What Apple shows

1. `altool` prints `UPLOAD SUCCEEDED` with a delivery UUID. That is the
   handoff; nothing more happens on this Mac.
2. App Store Connect > Apps > GoHealthMe > TestFlight lists the build as
   Processing. 5 to 20 minutes, sometimes longer on a first build. The
   account owner gets an email when it flips to Ready to Test.
3. If the build shows Missing Compliance, something regenerated `ios/` without
   `app.json`; it already carries `ITSAppUsesNonExemptEncryption=false`. Run
   `scripts/apple-build.sh` again without `--skip-prebuild`.

## Add testers

Internal (up to 100 people on the team, no review):

1. TestFlight > Internal Testing > plus > name the group (for example
   `founders`), tick Enable automatic distribution.
2. Add testers from Users and Access. They must already be on the team.
3. They get an email with the TestFlight invite; the app installs through
   the TestFlight app on their iPhone.

Public link (anyone with the link, up to 10,000, one Beta App Review on the
first build):

1. TestFlight > External Testing > plus > group, enable Public Link.
2. Fill the Test Information page (what to test, contact email, privacy URL)
   and submit the build for Beta App Review. Usually under 48 hours.
3. Copy the public link. That is the value for the website's
   `APPLE_APP_INSTALL_URL`.

## Flip the website on

Only once a build players can install exists, on the Vercel project
`gohealthme-tokyo`:

- `APPLE_APP_AVAILABLE=1` offers Apple Health in the wearable picker.
- `APPLE_APP_INSTALL_URL` is the TestFlight public link shown beside the
  pairing code.

Then the device QA from `docs/APPLE-LAUNCH-GATES.md`: pair from the site, allow
Health, see the sync count, sleep a night, join a sleep challenge, let SPOTTER
verify it.

## When it fails

| Message | Cause | Do |
|---|---|---|
| `APPLE_... is unset` | `.env.submit` missing a line | add it, values only, no quotes needed |
| `app.json has no expo.icon` | no app icon configured | add `"icon": "./assets/icon.png"` (1024x1024 PNG, no transparency) |
| `API key missing` | `.p8` not at `mobile/.secrets/AuthKey_<KEY_ID>.p8` | the file name must carry the Key ID |
| `No profiles for 'com.chuabiolabs.gohealthme'` or a capability error from the archive step | first run on a new team, or HealthKit not enabled on the identifier | re-run once; if it persists, Certificates, Identifiers and Profiles > Identifiers > the bundle ID > tick HealthKit, save, re-run |
| `Cloud signing permission error` | the API key role cannot create a distribution certificate | the key needs App Manager or Admin, and Access to Cloud Managed Distribution Certificate |
| `No suitable application records were found` from altool | app record not created yet | create it in App Store Connect (step 3 above), then `--upload-only` |
| `The bundle version must be higher than the previously uploaded version` | two uploads within the same minute | wait a minute and `scripts/apple-build.sh --skip-prebuild` |
| `pod install` errors about the spec repo | stale CocoaPods cache | the script already retries with `--repo-update`; if it still fails, `pod repo update` |

The full `xcodebuild` and `altool` output is in `mobile/build/logs/`.
