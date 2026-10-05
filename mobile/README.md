# GoHealthMe iPhone app: Apple Health into your GoHealthMe wallet

Expo (React Native) app that reads Apple Health on the iPhone with
`@kingstinct/react-native-healthkit`, aggregates each day on device, and posts
one number per metric per day to the GoHealthMe V4 deployment. Raw samples
(heart-rate series, sleep stage timings, routes) never leave the phone.

## How a player uses it

1. On the GoHealthMe website, choose **Apple Health** as the wearable. The site
   shows a one-time code (ten minutes, works once) and, on an iPhone, a
   button that opens this app with the code filled in.
2. In the app, **Pair**. The code is exchanged for a device token kept in the
   iPhone Keychain. The phone never holds a wallet key.
3. **Connect Apple Health** and allow the sheet. The last 30 days sync.
4. From then on the app syncs every time it is opened.

Pairing switches nothing on its own. The wallet's runs move to Apple Health
when the first day actually arrives, once per pairing. Pairing a second phone
cuts off the first.

## Files

| File | Purpose |
|---|---|
| `App.tsx` | The one screen: pair, connect, sync, last-sync status |
| `lib/api.ts` | Redeem a code, post aggregates with the device token |
| `lib/pairing-store.ts` | Keychain storage for the device token, deep-link parsing |
| `lib/healthkit.ts`, `lib/sleep-aggregate.ts` | On-device aggregation (see the anti-cheat notes in each) |
| `lib/sync.ts` | Collect and post |
| `eas.json` | `development-device` for a dev client, `production` for TestFlight |

## Build

HealthKit does not exist in the simulator. You need a physical iPhone.

TestFlight (needs the Apple Developer Program account, no Xcode):

```bash
npm install
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

Local dev client on a plugged-in phone (Xcode installed):

```bash
npm install
npx expo prebuild --clean
npx expo run:ios --device
```

`EXPO_PUBLIC_API_BASE` picks the deployment (defaults to
`https://gohealthme-tokyo.vercel.app`). The website that shows the code and the
app must point at the same deployment. Never the V3 pilot.

## Server side

- `/api/wearable/apple/pair/redeem` and `/api/wearable/apple/sync`, in `app/`.
- Supabase `wearable_days` must exist on the deployment's project.
- `APPLE_APP_AVAILABLE=1` offers Apple Health in the picker. Set it only once a
  build players can install exists. `APPLE_APP_INSTALL_URL` (a TestFlight public
  link) is shown next to the code.
