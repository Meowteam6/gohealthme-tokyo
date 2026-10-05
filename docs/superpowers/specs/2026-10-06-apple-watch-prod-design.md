# Apple Watch on prod: pair in two taps, sync in the background, pay on the verdict

Date: 2026-10-06. Status: draft for Andre's approval. Requirement from Andre: the UI and the user experience must stay easy; fewer clicks, nothing hidden, and the Apple path must feel like the WHOOP path.

## Intent

Andre and real beta users pair an Apple Watch to their GoHealthMe wallet and SPOTTER verifies sleep hours, sleep efficiency and workouts from it, on prod, with no demo paths. The user does the least possible: install the app, pair once, forget it.

## What already exists (verified 2026-10-06)

| Piece | State | Where |
|---|---|---|
| Server: Apple provider, capability gate, progress and data reads | done, tested | `app/lib/server/wearable/apple.ts` |
| Server: `wearable_days` table, RLS, retention sweep | live on prod's Supabase project (holds 2 test rows, steps only) | `supabase/migrations/20260908_wearable_days.sql` |
| Server: sync route (daily totals only, never raw samples) | done | `app/api/wearable/apple/sync/route.ts` |
| Server: pair by one-time code, device token in Keychain, one phone per wallet | done, 94 tests, **unmerged** | branch `feat/apple-pairing` (2 commits, 189 behind main) |
| iPhone app: HealthKit reads, hand-typed data refused, sleep stitched across midnight, overlapping sources merged | done on main, 19 tests, **never run on a phone** | `mobile/` (Expo 54, `@kingstinct/react-native-healthkit` 14.1) |
| iPhone app: pair screen, deep link `gohealthme://pair`, sync on launch and foreground, EAS production profile | done, **unmerged** | branch `feat/apple-pairing` |
| Picker flag `APPLE_APP_AVAILABLE`, install link `APPLE_APP_INSTALL_URL` | code done, **unset on prod** (Apple hidden) | `docs/WEARABLES.md` |
| Background delivery (sleep reaches the server without opening the app) | **missing** | `mobile/app.json` plugin flag |
| Native project (`mobile/ios/`, HealthKit + background entitlements, pods) | generated on the branch, **never compiled** | branch `feat/apple-pairing` |
| HealthKit calls | **two bugs that would stop any data on a phone** (verified against the installed 14.1 types): `requestAuthorization` gets a bare array where `{toRead}` is required, so the permission sheet never shows; the sleep and workout queries omit the required `limit`, so both throw and `allSettled` silently drops them. `as never` casts hid both from tsc | `mobile/lib/healthkit.ts` |
| Miss evidence (`getMissEvidence`) | **missing**: SPOTTER can never record a miss for an Apple player, so on the same challenge a WHOOP player loses a missed stake and an Apple player is refunded. The same skip (`miss.ts:399`) runs before the "met" branch, so the sweep **never auto-flags an Apple hit either**: an Apple player is paid only if they open the challenge page themselves | `app/lib/server/wearable/apple.ts`, `miss.ts:399` |
| Pool page phone handoff | **bug**: `WearableCheck.tsx:1192-1206` does not handle the phone-link case, so an Apple wallet pairing from a challenge page sees "The pairing page would not open" | `components/WearableCheck.tsx` |
| Provider pin | **bug**: every Apple sync re-pins the wallet to Apple, flipping back anyone who chose WHOOP or Junction | `app/api/wearable/apple/sync/route.ts:197-203` (fixed on the branch: once per pairing) |
| Sleep card | **bug**: iPhone-only wallets read "awaiting first sync" forever (`nightsReported` counts sleep days only) | `apple.ts:350`, QA 2026-09-26 major |
| Signing identity, EAS account, TestFlight | **none on this Mac** | Nikki's Apple Developer Program |

Research (2026-10-06, sources in the research report): Junction's Apple path needs the same native app plus $300/month; Terra $499/month; no-app bridges (Health Auto Export, Shortcuts) let anyone post a 20,000-step day for a stranger and are out. Own app via TestFlight wins on cost, privacy and time.

## 1. Decision: own Expo app, pair by code, TestFlight

Keep what is built. Merge `feat/apple-pairing` onto main (rebase over the 189 commits; 2 known conflicts in `DashboardContent.tsx` and `SensorStep.tsx`), fix the two HealthKit calls, add background delivery, make Apple equal to WHOOP on misses, build with EAS under Nikki's Apple Developer team, distribute on TestFlight, then flip the picker flag on prod.

**Equal to WHOOP is in scope.** Andre's standing rule is consistency across providers over depth in one. Today an Apple player can never lose a missed stake while a WHOOP player can; that is a money-fairness defect, said nowhere in the UI. Apple gets miss evidence (section 3.1), with the same "every local day covered, else refund" rule the others follow.

## 2. The user journey, counted in taps

WHOOP today: pick WHOOP (1) -> WHOOP login and consent (2-3) -> back on the pairing step, paired. Apple must match that or beat it.

**First time, on the iPhone (the common case: a player on their phone):**
1. Pairing step shows the Apple Watch card. Tap **Pair my Apple Watch** (1).
2. The site shows the code AND an **Open the GoHealthMe app** button. No app yet: the button is **Get the app** (TestFlight link). Tap (2).
3. The app opens with the code already filled in from the deep link. One tap **Pair** (3). iOS asks for Health access: **Allow** (4).
4. The app syncs the last 30 days on its own and shows "Synced N days for 0x1234..abcd". The web pairing step flips to **Apple Watch is paired** by itself (it polls, no refresh, no re-sign).

Four taps, two of them Apple's own sheets. Never typing a code on the phone when the site is open on the same phone. Never typing a wallet address. No signature on the phone at all.

**First time, from a computer:** same, except the code is typed into the app (8 characters, no 0/O/1/I ambiguity). The panel says it in one line.

**Every day after:** nothing. HealthKit background delivery wakes the app when sleep or a workout lands; it posts the day. Opening the app also syncs. The web never asks the user to "sync" anything; the dashboard shows the night tally like it does for WHOOP.

**Rules that bind the UI (Andre's SEAMLESS rule):**
- No extra step the system could do itself. The code is never typed when the deep link can carry it. The web detects the pairing by polling, never by a button.
- A limit is said before any stake: iPhone with no Watch cannot verify sleep; the join gate already says so at the pairing step. A sleep-score challenge is unjoinable for Apple; already enforced.
- The Apple card renders only when a build users can install exists (`APPLE_APP_AVAILABLE=1`), so nobody is sent to an app that is not there.
- Same card shape, copy length and states as the WHOOP card: unpaired, awaiting first sync, paired with its metrics, unreadable.

## 3. Changes

### 3.1 Web (Next.js app)
- Rebase and merge `feat/apple-pairing`: pairing routes, `PhonePairPanel`, `SensorStep` Apple card, `wearable-connect` phone handoff. The branch already fixes the re-pin bug (Apple is recorded once per pairing, on the first stored sync).
- **Miss evidence for Apple.** The phone posts, per sync, its timezone offset and a per-day "phone covered this day" marker (a day the phone read HealthKit for, data or not), plus a partial-night flag from the sleep stitcher. The table gains `tz_offset_sec` and `covered` columns (migration, additive, RLS unchanged). `appleProvider.getMissEvidence` builds `values`, `heartbeatDays` (covered days), `partialDays` and `tzOffsetSec` from them, so `miss.ts` treats Apple like WHOOP: a miss is recorded only when the phone covered every local day of the challenge and a sync landed after the window; anything less refunds. Flip the test that pins its absence (`apple.test.ts:574`). Day keying is the phone's local day end to end (the server comment that says UTC is wrong and gets fixed).
- Sleep card: `nightsReported` counts covered days, so an iPhone-only wallet is "synced, no sleep data (no Watch)" instead of stuck on "awaiting first sync".
- With miss evidence in place the sweep reaches the "met" branch for Apple, so an Apple hit is recorded and paid on the cron like WHOOP's, with no need to open the page. Test pinned.
- `WearableCheck` (pool page) renders the same `PhonePairPanel` the pairing step uses when the link kind is "app", instead of a generic error.
- `APPLE_APP_AVAILABLE=1` gates verification as well as the picker (`providerFor` never returns Apple without it): the flag flips only when the install link is real, and `.env.example` documents both vars plus `CRON_SECRET`.
- Copy that lies for Apple gets fixed: "give it a few minutes to sync" becomes "open the GoHealthMe app on your iPhone, or wait for its next background sync"; the cannot-measure lock names the missing Watch; the dashboard's "sleep score" line says efficiency for Apple.
- `PhonePairPanel` gets the two-tap layout above: primary button on iPhone is the deep link (or the install link when the app is missing), the code is secondary. Polls `/api/wearable/providers` every 3s while a code is live, flips to paired on the first stored sync, stops after 10 minutes.
- Night Shift styling, same tokens as the WHOOP card. Screenshots at 390 and 1440 before merge.
- Dashboard: the Apple night tally and "awaiting first sync" state read the same as WHOOP's.

### 3.2 iPhone app (`mobile/`)
- Fix the two HealthKit calls: `requestAuthorization({ toRead: READ_TYPES })`, and `limit: 0` (no limit) on the sleep and workout queries. Delete the `as never` casts so tsc catches the next one; type the results properly.
- Bump `@kingstinct/react-native-healthkit` to 16.x and enable `background: true` (HealthKit background delivery entitlement). Register observers for sleep, workouts and steps; on delivery, aggregate and post the affected days. Keep sync on launch and on foreground.
- Every sync posts `tzOffsetSec` and the list of days the phone covered, so the server can judge a miss honestly.
- Deep link opens the pair screen with the code filled; if already paired, a new code re-pairs (revokes the old token, as designed).
- First screen after pairing shows what synced and the paired wallet short address. One screen, no settings.
- Keep the fraud gate (`HKWasUserEntered` excluded), sleep stitching and source merge as is; they are tested.
- Build: `eas.json` production profile already points at `https://gohealthme-tokyo.vercel.app`. Add `ascAppId` once App Store Connect creates the app.

### 3.3 Prod env (Andre, dashboard only, no values in chat)
- `APPLE_APP_AVAILABLE=1` after the TestFlight link exists.
- `APPLE_APP_INSTALL_URL=<TestFlight public link>`.

### 3.4 Docs
- `docs/WEARABLES.md` Apple section: the two-tap flow, background delivery, TestFlight, who is worse off (nobody new: Apple was hidden before).

## 4. Gates only humans can open

| Gate | Who | What exactly | Blocks |
|---|---|---|---|
| Apple Developer team access | **Nikki** | Invite Andre's Apple ID to her team as **Developer** (or Admin) in App Store Connect > Users and Access, and give him the **Team ID** | every build |
| Bundle ID and App Store Connect app | **Nikki or Andre** (Admin on her team) | Register `com.chuabiolabs.gohealthme` with the HealthKit capability; create the app "GoHealthMe" in App Store Connect | EAS submit |
| EAS account | **Andre** | expo.dev account, `npx eas-cli login` on this Mac; free tier is enough (15 iOS builds/month, slow queue) | every build |
| App Store Connect API key for EAS submit | **Nikki** (Admin) | Users and Access > Integrations > App Store Connect API > key with App Manager role; download the .p8 once; Andre keeps it out of git | `eas submit` without typing her password |
| TestFlight testers | **Andre** | Internal group (Andre, Nikki, up to 100 team members: no review). External group for beta users: first build goes through Beta App Review, hours to 7 days, HealthKit apps get extra scrutiny | real beta users |
| Prod env flags | **Andre** | the two vars in 3.3 | Apple visible in the picker |

Nothing here needs a password or key pasted in chat. Keys land in files I name and you fill.

## 5. Testing and the QA loop

- The web side can be driven and screenshotted by me. The phone cannot: no simulator has HealthKit data, and this Mac has no signing identity. The device loop below is the only proof, and it needs Andre's iPhone and Watch.

- Unit: web pairing (94 existing), mobile aggregation (19 existing), new polling and background-delivery logic.
- Browser: drive the pairing step on a preview at 390 and 1440; the panel, the code, the paired flip.
- Device, the only proof that counts: Andre's iPhone + Watch on the TestFlight build: pair from the site on the phone (count the taps), allow Health, see the sync count, see the web flip; sleep one night, confirm the night lands without opening the app; join a sleep-hours challenge and let SPOTTER verify it on prod. Nikki repeats on hers.
- Negative: deny the Health sheet (copy says it is inconclusive by design, retry offered); iPhone without a Watch (sleep locked at the join, before any stake); pair a second phone (first is revoked); expired code (new code, one tap).
- Miss fairness: a short workouts challenge Andre deliberately misses with the phone covering every day: SPOTTER records the miss, same as it would for WHOOP. Then one where the phone skipped a day: refund, with the reason shown.

## 6. Timeline (earliest realistic)

Day 0: Nikki's invite + Team ID, EAS login, merge, background delivery, first EAS build (queue 1-2h). Day 0-1: internal TestFlight for Andre and Nikki, device QA. Day 1: flip prod flags, Apple visible to everyone with the TestFlight link. Day 1-7: external TestFlight review for public beta users (in parallel; internal testers are unaffected).

## 7. Risks

- Beta App Review stalls external testers (HealthKit strings). Internal group is live day one regardless; beta users can be added to the internal group as team members while review drags.
- `@kingstinct` 16.x API drift from 14.1 (the background manager was renamed). Pinned and tested in the merge.
- Background delivery is best-effort on iOS: steps hourly at most, sleep when Apple decides. The web copy says "syncs on its own, and whenever you open the app"; a miss is never recorded on a day the phone did not cover (existing rule).
- Sandbox vs. real: there is no sandbox for HealthKit; the only test is a real phone. That is the QA loop.
- `HKWasUserEntered` filtering has never been tested against real Watch samples; if it drops genuine data the first device sync will show it (counts on screen), and the filter is narrowed to metadata the Health app sets on manual entries.
- The 2 test rows already in `wearable_days` (steps, 2026-09-25, two wallets) came from the dev-key spike and are deleted before launch.
- Sleep efficiency is emitted only when HealthKit has `inBed` samples (the sleep stitcher, `sleep-aggregate.ts:151-166`). A Watch wearer with no iPhone Sleep Schedule may get hours but never efficiency, which would make efficiency challenges read as unsupported for them. Unverifiable without a device: the first real sync answers it, and if it bites, efficiency falls back to asleep over the stitched night span.
