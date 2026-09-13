# GoHealthMe iPhone app: Apple Watch into your GoHealthMe wallet

Expo (React Native) dev-client app that reads **Apple Health / Apple Watch**
through the native **Open Wearables SDK** and streams it to a **self-hosted
Open Wearables** backend (FastAPI, Postgres, Redis, Celery) running in Docker.

Phase 1 scope: **our own metrics only** (Andre, Nikki). No public users, no
paid Apple Developer account, backend on the Mac, phone on the same Wi-Fi.

The earlier Junction (Vital) SDK version of this spike is the first commit in
git history.

## Why an app at all

Apple exposes HealthKit only on the device. There is no cloud API for Apple
Health, so every vendor (Open Wearables, Junction, Terra) ships a native SDK
you embed in an iOS app. Open Wearables' iOS SDK reads HealthKit read-only,
stores credentials in the Keychain, and POSTs batches to the backend:

```
iPhone / Apple Watch
  -> HealthKit (read-only, observer queries + background delivery)
    -> OpenWearablesHealthSDK 0.14.0 (via open-wearables RN module 0.2.0)
      -> POST {host}/api/v1/sdk/users/{userId}/sync   (202, queued)
        -> Celery worker process_sdk_upload
          -> Postgres: data_point_series (steps, HR, HRV ...), event_record (sleep, workouts)
            -> GET /api/v1/users/{id}/summaries/{activity,sleep}  (what GoHealthMe will read)
```

## Layout

| File | Purpose |
|---|---|
| `App.tsx` | The single screen: Connect, Sync again, Disconnect, SDK status, SDK log |
| `lib/openwearables.ts` | SDK wiring: configure, signIn (token mode), requestAuthorization, startBackgroundSync, resumeSync, events |
| `app.json` | Expo config: the `open-wearables` config plugin (HealthKit entitlements, Info.plist strings, background modes, BGTask ids) and local-network ATS exception |
| `scripts/ow-setup.sh` | Mac-side, one time: developer login, API key and application credentials for the GoHealthMe backend. Prints the server env block |
| `scripts/ow-check.sh` | Mac-side proof: recent sync events plus daily activity and sleep summaries for the user |
| `.env.example` | The two values the app needs: the GoHealthMe base URL and the dev signer key |

## Prerequisites (one-time)

1. **Xcode** from the App Store (the Command Line Tools alone cannot build for a device), then `sudo xcode-select -s /Applications/Xcode.app` and open Xcode once to accept the license.
2. **Node 18+** and CocoaPods (`sudo gem install cocoapods` or `brew install cocoapods`).
3. **The Open Wearables backend running** on this Mac: `cd ../../open-wearables && docker compose up -d`. The API is mapped to port **8010** here because 8000 was already in use; the developer portal is on 3000.
4. **The React Native SDK checked out next to this folder** at `../../open-wearables-react-native-sdk` (the package is not on npm yet, so `package.json` installs it from that path).
5. **A free Apple ID signed into Xcode** (Xcode > Settings > Accounts). A Personal Team can sign HealthKit apps. Limits: profiles expire after 7 days, up to 3 apps per device, up to 10 App IDs per week, rebuild after expiry.

## Run it

```bash
# 1. backend up (once per boot)
cd ~/Desktop/eth/open-wearables && docker compose up -d

# 2. one-time: mint the SERVER credentials the web app needs
cd ~/Desktop/eth/gohealthme-base/mobile
scripts/ow-setup.sh                # prints the OPEN_WEARABLES_* block for the web app

# 3. install and generate the native project
npm install
npx expo prebuild --clean          # applies the open-wearables config plugin to ios/

# 4. sign with the Personal Team, once
open ios/GoHealthMe.xcworkspace    # Signing & Capabilities > Team: your name (Personal Team)
                                   # HealthKit + Background Modes are already present from the plugin

# 5. build to the plugged-in iPhone
npx expo run:ios --device
```

On the phone: trust the developer certificate (Settings > General > VPN &
Device Management) the first time, open the app, tap **Connect Apple
Health**, allow the requested types on the HealthKit sheet.

On the Mac, prove it landed:

```bash
scripts/ow-check.sh 7
```

Look for `sync` events and non-empty daily rows. The phone screen never
claims success on its own, because iOS hides HealthKit grant or deny from
apps; only rows in the backend count.

## What the config plugin writes (for Xcode readers)

Entitlements: `com.apple.developer.healthkit` and
`com.apple.developer.healthkit.background-delivery`. Info.plist:
`NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`,
`UIBackgroundModes` (`fetch`, `processing`),
`BGTaskSchedulerPermittedIdentifiers`
(`com.openwearables.healthsdk.task.refresh`,
`com.openwearables.healthsdk.task.process`). Plus, from `app.json`,
`NSAppTransportSecurity.NSAllowsLocalNetworking` so plain http to the Mac's
LAN address works in Phase 1 only.

## Known limits

- The SDK docs list a `syncNow`; the 0.2.0 native module does not export it. The first export starts inside `startBackgroundSync`, and `resumeSync` (the Sync again button) re-runs a round.
- Token expiry is 60 minutes by default; the SDK refreshes on 401 with the refresh token. If the refresh token itself is rejected, re-run `scripts/ow-bootstrap.sh` and rebuild (Phase 1 only; Phase 2 fetches tokens from the GoHealthMe backend at runtime).
- Phase 2 (real users) replaces `.env` credentials with a GoHealthMe backend route that calls `POST /api/v1/users/{id}/token` with the app credentials and maps the Open Wearables user to the wallet address, mirroring the existing Junction `mobile-token` route in `gohealthme-base`.
