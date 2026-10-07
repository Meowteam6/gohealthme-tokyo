# GoHealthMe iPhone app: the whole product, with Apple Watch pairing native

Expo (React Native) app that reads Apple Health directly on the iPhone with
`@kingstinct/react-native-healthkit`, aggregates each day on device, and posts
one number per metric per day to the GoHealthMe V4 deployment. Raw samples
(heart-rate series, sleep stage timings, routes) never leave the phone. There
is no middleman service: HealthKit is readable only on the device that holds
it, so this app is the Apple provider.

Stage: beta on testnet, like the rest of V4.

## How a player uses it

The app is GoHealthMe itself. It opens the site (https://gohealthme-tokyo.vercel.app)
in a native shell, so signing in, making a player, joining and creating
challenges, verdicts and payouts all happen the same way they do on the web.
The one thing the shell does natively is Apple Watch pairing.

1. Open the app. Sign in with your email; the code arrives by mail and the
   wallet is made from the email. (Base Account and own-wallet sign-in cannot
   finish inside an in-app browser, so the shell says so in one line and
   those accounts keep using Safari.)
2. In character creation, choose **Apple Watch** and tap **Pair my Apple
   Watch**. The page hands a one-time code to the shell over the bridge; the
   code is never shown. The shell exchanges it for a device token kept in the
   iPhone Keychain. The phone never holds a wallet key.
3. iOS asks for Health access. **Allow**. The app registers for background
   delivery, reads the last 30 days and the card flips to paired the moment
   the server has stored a day.
4. Nothing after that. HealthKit wakes the app when sleep, a workout or steps
   land, and the app posts the recent days. Opening the app also syncs.

Two taps, one of them Apple's sheet. The standalone pairing screen from the
first build still exists (`components/PairScreen.tsx`) and only appears when
the site cannot load; a `gohealthme://pair?code=` link from Safari still
pairs the phone too.

## What one sync sends

```json
{
  "days": [{ "metric": "sleep_hours", "day": "2026-10-05", "value": 7.5 }],
  "tzOffsetSec": 32400,
  "coveredDays": ["2026-09-06", "...", "2026-10-06"]
}
```

- `days`: one row per metric per local day with data. A sleep row carries
  `"partial": true` when the night is not final (a nap only, under three
  hours, or still in progress when the phone synced).
- `tzOffsetSec`: the device's UTC offset in seconds, positive east of
  Greenwich, so the server can read the day strings.
- `coveredDays`: every local day the phone read HealthKit for in full, data
  or not. The server records a missed challenge only when the phone covered
  every day of the window; anything less refunds. `days` may be empty;
  coverage still counts. The read starts one day before the first covered
  day so that day's night is whole; the margin day's own night is cut at
  midnight by the query, so it is never posted or covered (`lib/days.ts`,
  `reportFrom`).

Hand-typed Health entries (`HKWasUserEntered`) are excluded on every read.
Sleep stages are stitched into nights before a day is assigned, and
overlapping sources are counted once. `lib/sleep-aggregate.test.ts` pins both.

## Files

| File | Purpose |
|---|---|
| `App.tsx` | The one screen: pair, allow Health, sync status |
| `lib/api.ts` | Redeem a code, post a sync body with the device token |
| `lib/pairing-store.ts` | Keychain storage for the device token, deep-link parsing |
| `lib/healthkit.ts` | HealthKit reads, typed against the library, no casts |
| `lib/sleep-aggregate.ts` | Nights, efficiency and the partial flag (pure, tested) |
| `lib/days.ts` | Local calendar days, covered-day list, timezone offset (pure, tested) |
| `lib/sync.ts` | Collect, build the body, post |
| `lib/background.ts` | HealthKit background delivery: what is observed, how a wake syncs |
| `eas.json` | `internal` for ad-hoc installs, `production` for TestFlight |

## Background delivery

`app.json` passes `background: true` to the HealthKit config plugin, which
adds the `com.apple.developer.healthkit.background-delivery` entitlement. The
library's core pod registers observer queries at launch before JS boots and
queues any event that fires in that gap, so no AppDelegate change is needed.
`lib/background.ts` configures sleep, workouts and steps, asks Apple for
immediate delivery on sleep and workouts and hourly on steps, and on a wake
runs one sync of today and the two days before it through the ordinary path.
Deliveries inside a two-second burst are coalesced into one sync. The app
holds exactly one listener per process (`createBackgroundListener`): the
native side keeps a single callback per type, so two live subscriptions for
one wallet would silence each other.

iOS decides when a wake actually happens; it is best effort, and a miss is
never recorded for a day the phone did not cover.

## Build

HealthKit does not exist in the simulator. A physical iPhone is required.

```bash
cd mobile
npm install
npx eas-cli login              # Andre's expo.dev account
npx eas-cli init               # links the project; Andre runs this once
```

TestFlight build and submit:

```bash
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

Ad-hoc install on registered devices (no App Store Connect):

```bash
npx eas-cli build --platform ios --profile internal
```

Local dev client on a plugged-in phone (Xcode installed):

```bash
npx expo prebuild --clean
npx expo run:ios --device
```

`EXPO_PUBLIC_API_BASE` picks the deployment (defaults to
`https://gohealthme-tokyo.vercel.app`, set in both EAS profiles). The website
that shows the code and the app must point at the same deployment. Never the
V3 pilot.

`@react-native-healthkit/core` is installed automatically as an exact-pinned
dependency of the HealthKit package; do not add it by hand.

`app.json` points `icon` at `assets/icon.png` (1024x1024, no alpha). App
Store Connect refuses a build that ships Expo's placeholder icon (ITMS-90717),
so keep the key when touching `app.json`.

## What Andre and Nikki must supply

Nothing here needs a password or key pasted in chat. Keys land in files named
below and stay out of git (`.gitignore` already covers them).

| Gate | Who | What |
|---|---|---|
| Apple Developer team access | Nikki | Invite Andre's Apple ID to her team as Developer or Admin in App Store Connect, Users and Access, and give him the Team ID |
| Bundle ID and App Store Connect app | Nikki or Andre (Admin) | Register `com.chuabiolabs.gohealthme` with the HealthKit capability; create the app "GoHealthMe" |
| EAS account | Andre | expo.dev login on this Mac, then `npx eas-cli init` in `mobile/` |
| App Store Connect API key | Nikki (Admin) | Users and Access, Integrations, App Store Connect API, App Manager role; the `.p8` goes under `mobile/.secrets/`, and `ascAppId` goes in `eas.json` under `submit.production.ios` once the app exists |
| TestFlight testers | Andre | Internal group first (no review); external group goes through Beta App Review |
| Prod env flags | Andre | `APPLE_APP_AVAILABLE=1` and `APPLE_APP_INSTALL_URL=<TestFlight link>` on the Vercel project, dashboard only |

## Tests

```bash
npx vitest run
npx tsc --noEmit
```

Everything with money in it is pure and tested off a phone: sleep stitching,
the partial flag, covered days, the sync body shape, the HealthKit call shapes
(mocked, so a wrong argument shape fails here and not on a user's wrist), and
the background-delivery registration and coalescing.

The screen itself has no automated test. The device loop is the only proof:
pair from the site on a phone, allow Health, see the count, sleep one night,
confirm the night lands without opening the app.

## Server side

- `/api/wearable/apple/pair/redeem` and `/api/wearable/apple/sync`, in `app/`.
- Supabase `wearable_days` must exist on the deployment's project.
- `APPLE_APP_AVAILABLE=1` offers Apple in the picker. Set it only once a build
  players can install exists. `APPLE_APP_INSTALL_URL` (a TestFlight public
  link) is shown next to the code.
