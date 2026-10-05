# Wearables: turning a provider on

Everything an operator needs to take the wearable path from a fresh checkout to
a working connect, without reading the code. Covers the Junction and
WHOOP-direct paths, the shared plumbing, and the Apple Watch path (pushed from
the GoHealthMe iPhone app) under "Apple Health" below.

## What each provider can actually verify

A pool is scored on one metric. A provider that cannot measure that metric is
refused **at the join**, with the reason on screen, before any entry fee is
paid. This table is the source of that behaviour.

| Metric | Junction | WHOOP direct | Apple Health |
|---|---|---|---|
| `sleep_score` (proprietary 0-100) | yes, if the linked device produces one | yes | **no** |
| `sleep_efficiency` (asleep / in bed) | yes | yes | yes, with a Watch |
| `sleep_hours` | yes | yes | yes, with a Watch |
| `workouts` (sessions per day) | yes | yes | yes |
| `steps` | yes | **no** | yes |
| `distance_km` | yes | **no** | yes |
| `active_calories` | yes | **no** | yes |

The three WHOOP gaps are physical or semantic, not scope decisions:

- **steps** - a WHOOP strap has no pedometer. There is no number to read.
- **distance_km** - WHOOP records distance only inside a logged workout. Serving
  it would pass a runner and silently fail a walker on the same goal.
- **active_calories** - WHOOP reports total energy expenditure including basal
  metabolism, roughly 2500 kcal for an adult who did nothing. Junction's number
  is active calories, a few hundred. Reporting one as the other would clear a
  500-calorie goal every day without the user moving.

Apple's one gap is the same shape:

- **sleep_score** - Apple publishes no proprietary 0-100 sleep score. The app
  computes time asleep over time in bed and reports it as `sleep_efficiency`,
  which is what it actually is. A pool authored as "sleep score 75+" is
  therefore unjoinable for an Apple wallet, refused at the join.

Apple and Junction are the providers that can verify a **steps** challenge.
Launch challenges are created on the intersection of every offered provider
(`LAUNCH_METRICS`: sleep efficiency, hours of sleep, workouts), so with WHOOP
offered a steps challenge is not created in the first place.

Apple's "with a Watch" rows are narrowed per wallet rather than per provider.
An iPhone with no Apple Watch produces steps and distance and no sleep at all,
and the join gate reads what that person's hardware has actually produced, so
they are refused a sleep pool before staking rather than after. See
`observedMetrics` under Per-device capability.

`sleep_score` and `sleep_efficiency` are separate metrics on purpose, and
WHOOP's own field documentation is the reason. Efficiency is "the time you
spend in bed that you are actually asleep"; WHOOP's performance percentage is
"the time a user is asleep over the amount of sleep the user needed". Different
denominators - time in bed versus sleep needed - so they are not two estimates
of one quantity. A pool authored as "sleep score 75+" and one authored as
"sleep efficiency 90+" are different goals.

WHOOP also documents that its performance percentage "may not be reported if
WHOOP does not have enough data about a user yet to calculate Sleep Need", so a
scored night with no score is expected rather than broken. It reports as missing
data and never as a zero.

**One honesty caveat worth knowing.** `sleep_score` is not strictly comparable
ACROSS providers. WHOOP's number is sleep-versus-need; another brand reached
through Junction reports its own proprietary formula. Both are 0-100 quality
scores and that is the closest thing to a common unit available, but a pool
threshold does not mean identically the same thing to two people on different
brands. This is a limit of the vendors, not of the code, and it is stated here
rather than hidden.

## Environment variables

All server-only. Nothing here is exposed to the browser.

| Name | Required | What it is |
|---|---|---|
| `WEARABLE_PROVIDER_DEFAULT` | optional | Which provider a wallet that has never linked is offered first. `junction` or `whoop`. Defaults to `junction`. Ignored if it names a provider this deployment has no credentials for. |
| `JUNCTION_API_KEY` | for Junction | Key from the Junction dashboard. `sk_us_...` for US. |
| `JUNCTION_BASE_URL` | optional | Defaults to the sandbox host. |
| `JUNCTION_REGION` | optional | Defaults to `us`. |
| `JUNCTION_ENV` | optional | `sandbox` or `production`. Defaults to `sandbox`. |
| `JUNCTION_TIMEOUT_MS` | optional | Milliseconds before a hung call is abandoned. Defaults to 15000. |
| `WHOOP_CLIENT_ID` | for WHOOP | From the WHOOP developer dashboard. |
| `WHOOP_CLIENT_SECRET` | for WHOOP | Same. Shown once. |
| `WHOOP_REDIRECT_URI` | for WHOOP | The exact absolute callback URL registered with WHOOP. See below. |
| `WHOOP_TIMEOUT_MS` | optional | Defaults to 15000. |
| `APPLE_APP_AVAILABLE` | to offer Apple | `1` offers Apple Watch in the picker and lets SPOTTER read a wallet through Apple. Unset, Apple is hidden and the picker says "Apple Watch is not open on this build yet." Set it only once `APPLE_APP_INSTALL_URL` is real. Details under Apple Health. |
| `APPLE_APP_INSTALL_URL` | to offer Apple | The `https://` TestFlight public link, shown as Get the app beside the pairing code. |
| `CRON_SECRET` | yes | Bearer secret for the Vercel crons, including `/api/cron/wearable-retention` (daily sweep of Apple days older than 120 days). |
| `WEARABLE_TOKEN_KEY` | **whenever WHOOP is on** | 32 bytes, base64 or hex. Encrypts the per-wallet OAuth records at rest. Generate with `openssl rand -base64 32`. |

`WEARABLE_TOKEN_KEY` has **no plaintext fallback by design**. A direct provider
hands us an access and refresh token per user, which are that person's health
data as far as an attacker is concerned. Without the key, WHOOP reports itself
as unavailable rather than storing credentials in the clear, and the picker
simply does not offer it.

Junction and WHOOP are independent. Leaving either block blank turns that
provider off; the app runs on whichever is configured.

## Registering the WHOOP developer app

1. **You need an active WHOOP membership and a device.** WHOOP requires every
   developer on the platform to have one, and your WHOOP account is the
   developer login. There is no way around this step.
2. Go to `developer-dashboard.whoop.com` and sign in with that account.
3. Create a Team, then create an App. The limit is 5 apps per account.
4. The form asks for: app name, contact email, a **privacy policy URL** (use
   `https://<your-domain>/privacy`), at least one scope, and at least one
   redirect URI.
5. Tick exactly these scopes: **`read:sleep`**, **`read:workout`**, **`offline`**.
   - `offline` is what makes WHOOP issue a refresh token. Verification runs on a
     cron long after the user has closed the browser, so without it the
     integration stops working an hour after every connect.
   - `read:cycles`, `read:recovery`, `read:body_measurement` and `read:profile`
     are deliberately not requested. Nothing in the product is measured against
     them, and a read only ever calls the endpoint the pool's own metric needs.
6. Copy the client id and secret into `WHOOP_CLIENT_ID` and
   `WHOOP_CLIENT_SECRET`. The secret is shown once.
7. Access to the WHOOP API is currently free. WHOOP's terms reserve the right to
   start charging with prior notice.

## The approval gate, and what it means for a pilot

An un-approved WHOOP app is capped at **10 WHOOP members total, including your
own account.** Serving anyone beyond that requires submitting the app for
review, and **WHOOP publishes no review SLA**. Community reports describe waits
of multiple weeks with no acknowledgement.

Plan around the queue, not around the code. The integration is finished and
tested; what gates a real pilot is WHOOP's review. Submit early. Review checks
compliance with the API terms and the brand guidelines, the accuracy of your app
metadata, and that you have tested with at least one real WHOOP member.

Two terms worth knowing before you write launch copy:

- WHOOP's terms **ban building databases or keeping permanent copies of WHOOP
  data**. This app stores none: every read is live, and the only thing persisted
  for a WHOOP user is their encrypted OAuth token.
- The terms prohibit apps that promote or facilitate **online gambling**, and
  never define it. WHOOP adjudicates at approval. Keep wager, odds and betting
  language out of anything they will read.

## The redirect URI, and the Vercel preview problem

WHOOP matches redirect URIs **exactly** against what you pre-registered.
Preview deployments get a new hostname on every push, so a preview URL can never
be registered in advance and OAuth breaks there.

**Use a stable alias domain.** Point one domain at the deployment you test on,
register that single absolute HTTPS callback with WHOOP, and set
`WHOOP_REDIRECT_URI` to it:

```
WHOOP_REDIRECT_URI=https://<stable-alias>/api/whoop/callback
```

Previews stay useful for everything else; only the WHOOP connect needs the
alias. WHOOP allows multiple redirect URIs per app, so register a development
tunnel alongside it if you want a local loop. Whether plain `http://localhost`
is accepted is not documented and reports conflict, so do not build the dev loop
on it.

## Verifying it works

1. Set the variables, deploy to the alias domain, open `/dashboard`.
2. With both providers configured you see a picker. Choose **Connect WHOOP**.
   The current tab navigates to WHOOP's consent screen; that is deliberate,
   because the flow returns to the dashboard.
3. Approve. You land back on `/dashboard` with "WHOOP connected."
   - Decline instead and you get "You declined access on WHOOP's screen, so
     nothing was connected." That is the honest path, not a failure.
4. Immediately after connecting, the streak card reads "connected and has not
   sent anything yet". That is correct: WHOOP delivers a night's sleep after you
   have slept. It is not an error and nothing is charged while you wait.
5. Open `/pools`. A steps pool now appears under "Your device cannot measure
   these", dimmed, with a link to change your device. Opening it shows no join
   button. **That is the integration working**, not a bug.

**If a credential is wrong** you will see "The WHOOP connection is not available
on this deployment" (missing config) or a failure on return from WHOOP
(`whoop=failed`). Neither is silent, and neither pretends a device was linked.

## Apple Health (Apple Watch)

Apple is the only **pushed** provider. HealthKit is readable only on the device
that holds it, there is no cloud API, and there never will be, so nothing pulls
Apple. The GoHealthMe iPhone app (`mobile/`, Expo) reads Health on the phone,
adds up each day there, and posts the daily totals to
`/api/wearable/apple/sync`. With `APPLE_APP_AVAILABLE=1` on, Apple is a
first-class provider: every sleep-hours, sleep-efficiency and workouts
challenge WHOOP can play, Apple plays, pays and misses the same way.

**Raw samples never leave the phone.** One number per metric per calendar
day, keyed as the **wearer's local day** end to end: the phone closes each day
in its own time zone, sends its UTC offset with it, and the server stores and
reads the day as sent. Heart-rate series, sleep stage timings, workout routes
and GPS traces stay on the device permanently. This is a stronger privacy
position than the pulled providers, where the raw samples sit in a vendor's
database.

### Pairing: two taps on the phone

1. On the pairing step, tap the button on the Apple Watch card
   (`components/game/SensorStep.tsx`). The site mints a one-time code (ten
   minutes, works once) and shows **Open the GoHealthMe app**, with **Get the
   app** under it, the TestFlight link in `APPLE_APP_INSTALL_URL`
   (`components/PhonePairPanel.tsx`).
2. The app opens with the code filled in from the deep link
   (`gohealthme://pair?code=...`). Tap **Pair**. iOS asks for Health access.
   Tap **Allow**.

That is the whole flow. The app syncs the last 30 days on its own and shows
how many days it synced and the paired wallet's short address. The web pairing
step flips to **Apple Watch is paired** by itself: it polls
`/api/wearable/providers` while a code is live, no refresh and no second
signature. From a computer the
flow is the same except the 8-character code (no 0, O, 1, I or L) is typed
into the app.

How the server knows whose phone it is: the code is minted behind the wallet's
signed-in web session; the app redeems it at `/api/wearable/apple/pair/redeem`
for a device token kept in the iPhone Keychain; every sync sends
`Authorization: Bearer <token>` and the server writes under the wallet the
token was issued for, ignoring any address in the body. Only the token's hash
is stored. One phone per wallet: pairing again revokes the previous token.
Code: `app/lib/server/wearable/apple-pairing.ts`.

**Provider overlap.** One provider per wallet decides every verdict
(`lib/server/wearable/index.ts`). Redeeming a code switches nothing, so a
paired-but-never-synced phone leaves a working Junction or WHOOP link in
charge. The first sync that stores rows after a pairing records Apple, once;
later syncs only store days, so a player who switches to WHOOP on the web is
not flipped back by the next phone sync. Pairing again is the way back.

### Every day after: background delivery

Nothing for the player to do. HealthKit background delivery wakes the app
when sleep, a workout or steps land, and the app posts the affected days.
Opening the app also syncs. iOS decides the timing (steps at most hourly,
sleep when Apple delivers the night), so the web copy says "syncs on its own,
and whenever you open the app" and never asks anyone to sync by hand.

### Coverage, and how a miss is judged

A day with no row means either "no workout that day" or "the phone never read
that day", and the miss rule refuses to forfeit a stake on absence of data.
Two additions let SPOTTER tell those apart, so an Apple player who misses
loses the stake the way a WHOOP player does
(`supabase/migrations/20261006000000_wearable_days_coverage.sql`):

| Column or table | What it holds |
|---|---|
| `wearable_days.tz_offset_sec` | the wearer's UTC offset, in seconds, at the sync that wrote the row |
| `wearable_days.partial` | true for a sleep night the phone could not close; counts toward a pass, never as a covered night for a miss |
| `wearable_sync_days` | one row per wallet per local day the phone read HealthKit for, data or not, with the offset and `synced_at`. Holds no health data |

The rule (`app/lib/server/agent/miss.ts`): a miss is recorded only when the
phone covered every local day of the challenge window and a sync landed after
the window closed. A covered day with no workouts row is a real zero. An
uncovered day is unknown, and unknown refunds, with the reason shown. A phone
build older than coverage sends no offset (the server then covers only the
days it sent data for), and with no offset the rule records nothing, so those
players are refunded on a miss, as before. A hit is recorded and paid on the
sweep cron like WHOOP's; nobody has to open the challenge page to be paid.

### Environment

Server side, on the Vercel project `gohealthme-tokyo` (names only, values
never in chat, notes or git):

| Name | Required | What it is |
|---|---|---|
| `APPLE_APP_AVAILABLE` | to offer Apple | `1` offers Apple in the picker AND lets SPOTTER read a wallet through Apple (`providerConfigured` in `lib/server/wearable/index.ts`). Unset, Apple is hidden, a wallet whose phone already synced is read through the fallback provider, and `/api/wearable/providers` carries the note "Apple Watch is not open on this build yet." so that is never silent. Flip it only once the install link is real. |
| `APPLE_APP_INSTALL_URL` | to offer Apple | `https://` TestFlight public link, shown as **Get the app** beside the code. Anything else is ignored. |
| `CRON_SECRET` | yes | The bearer secret Vercel sends to `/api/cron/wearable-retention` (daily, `17 3 * * *` in `app/vercel.json`), which runs `sweep_wearable_days(120)` over both tables. Without it the route answers 500 and nothing is ever deleted. |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | yes | The store. Without the service-role key the redeem and sync routes answer 503. |

Phone side: `EXPO_PUBLIC_API_BASE` in `mobile/eas.json` (production profile
points at `https://gohealthme-tokyo.vercel.app`). The website that shows the
code and the app must point at the same deployment. Never the V3 pilot.

### The tables

`wearable_days` and `wearable_sync_days` on the V4 Supabase project (ref
`ecuzwwgatvqtuvsivnyi`; `wearable_days` verified live 2026-10-06, the coverage
migration not yet applied as of that date). **The coverage migration is a hard
prerequisite, not a nice-to-have:** the sync route writes `tz_offset_sec`,
`partial` and the covered days on every post (`apple-store.ts` `putDays`,
`putCoveredDays`), and a missing column or table makes every
`/api/wearable/apple/sync` answer 502, so no phone can store a day until it
lands. Step 1 of the launch checklist applies it. `wearable_days` is the
**only** table in that database holding health data and its comment says so;
`wearable_sync_days` says what days were read, never what happened on them.

RLS on, no anon policy, the service role is the only reader and writer, behind
the device token the sync route checks. Check constraints mirror the metric
union, reject negative values and reject future days, because pre-satisfying a
window that has not happened is the cheapest possible forgery.

Retention: `sweep_wearable_days(120)` over both tables, run daily by
`/api/cron/wearable-retention`. Health data kept longer than it is useful is a
liability, not a feature.

### Launch checklist (TestFlight)

Gates only humans open: Nikki invites Andre's Apple ID to her Apple Developer
team (Developer or Admin) and gives him the Team ID; the bundle id
`com.chuabiolabs.gohealthme` is registered with the HealthKit capability and
the app "GoHealthMe" exists in App Store Connect; Andre has an expo.dev
account; an App Store Connect API key (App Manager) exists for `eas submit`.
No password or key is pasted in chat; keys land in files the session names.

1. Apply `supabase/migrations/20261006000000_wearable_days_coverage.sql` to
   the V4 project (recipe in `docs/DATABASE.md`), and delete the two dev-key
   test rows in `wearable_days` (steps, 2026-09-25, two wallets). Before this,
   every phone sync answers 502.
2. Deploy this branch (preview first, then promote) and run
   `node --env-file=app/.env.local scripts/apple-launch-check.mjs --base <url>`
   from the repo root against a URL a browser opens without a login. Expect
   `providers lists apple` and `APPLE_APP_INSTALL_URL` to fail until step 7;
   everything else PASS.
3. `cd mobile && npm ci`
4. `npx eas-cli login`, then `npx eas-cli init` (links the Expo project and
   writes its id into `app.json`).
5. `npx eas-cli build --platform ios --profile production` (free tier queue,
   1 to 2 hours). The production profile already sets `EXPO_PUBLIC_API_BASE`.
6. `npx eas-cli submit --platform ios --profile production`. Add `ascAppId` to
   `eas.json` once App Store Connect has created the app. Then App Store
   Connect, TestFlight: add the **internal** group first (Andre, Nikki, up to
   100 team members, no review). Copy the public link.
7. Vercel dashboard, project `gohealthme-tokyo`: set `APPLE_APP_INSTALL_URL`,
   then `APPLE_APP_AVAILABLE=1`. Env applies on the next deployment, so
   redeploy.
8. `node --env-file=app/.env.local scripts/apple-launch-check.mjs` from the
   repo root: every row PASS.
9. Device QA on a real iPhone and Watch (see below), then the **external**
   group for beta users. The first external build goes through Beta App
   Review (hours to 7 days; HealthKit strings get extra scrutiny). Internal
   testers are unaffected while it drags, and a beta user can be added to the
   internal group as a team member in the meantime.

### `scripts/apple-launch-check.mjs`

One command, one table, nothing changed. Reads the Supabase trio, `CRON_SECRET`
and the Apple vars from the env file passed with `--env-file` (never printed;
only set or unset) and probes the deployment named by `--base` (default
`https://gohealthme-tokyo.vercel.app`). A Vercel preview behind SSO answers
401 with a login page to everything; the rows that expect a 401 accept only
the app's own JSON refusal, so a protected URL fails them instead of passing
by accident. Use a URL a browser opens without a login.

| Row | Pass means |
|---|---|
| `supabase env` | `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set |
| `wearable_days` | PostgREST answers 200 with the service role: reachable, table exists |
| `wearable_sync_days` | same for the coverage table. FAIL "pending migration" when it is missing: every sync answers 502 until the coverage migration lands |
| `coverage columns` | `wearable_days` has `tz_offset_sec` and `partial`. FAIL "pending migration" otherwise, same reason |
| `sweep_wearable_days` | the retention function exists (probed with a 100-year window, deletes nothing) |
| `providers lists apple` | `/api/wearable/providers` lists apple with `configured: true`; FAIL prints the note when it is false |
| `APPLE_APP_INSTALL_URL` | set, `https://`, answers 2xx |
| `redeem rejects a bad code` | 400, not 503 (503 means no service-role key on the deployment; 404 means the pairing routes are not deployed) |
| `sync refuses an unpaired phone` | the app's own 401 without a device token |
| `retention cron locked` | the app's own 401 without the secret (500 means `CRON_SECRET` is unset on the deployment) |

Exit code 1 on any FAIL. A Supabase 401 or 403 on the table rows means the
key in the env file is not this project's service-role key.

### Device QA, the only proof that counts

**As of 2026-10-06 no build of the iPhone app has run on a phone.** The
HealthKit calls, the pairing, background delivery and coverage are unit-tested
(`mobile/lib/*.test.ts`) and have never been exercised against real Health
data; the first TestFlight build is where every phone-side claim in this
section gets its evidence, and until then "works on the phone" is a design,
not a result.

No simulator has HealthKit data and nothing on a Mac can stand in for a
Watch. On the TestFlight build, with a real iPhone and Watch: pair from the
site on the phone and count the taps (two on the phone plus Apple's own Allow),
see the sync count, see the web flip. Sleep one night and confirm the night
lands without opening the app. Join a sleep-hours challenge and let SPOTTER
verify it. Negative paths: deny the Health sheet (copy says it is inconclusive
by design, retry offered); an iPhone without a Watch (sleep locked at pairing,
before any stake); pair a second phone (the first is revoked); an expired code
(new code, one tap). Miss fairness: a short workouts challenge missed on
purpose with the phone covering every day records the miss; one where the
phone skipped a day refunds, with the reason shown.

### Telling a real failure from the system working

- **"Nothing was sent" is inconclusive by design.** iOS never tells an app what
  was granted. No data in Health, a Watch that has not synced to the iPhone,
  and a denied permission sheet are indistinguishable from inside the app, and
  the copy says exactly that rather than guessing at one of them.
- **A sleep challenge refused for an iPhone-only wallet is the gate working.**
  That person has no Watch, so there is no sleep data and never will be until
  they get one. The pairing step says it.
- **A sleep-score challenge refused for any Apple wallet is correct.** Apple
  has no such number.
- **A 401 from `/api/wearable/apple/sync`** means the phone is not paired: no
  device token, or a token a later pairing revoked. Pair again from the
  website.
- **A 503** from redeem or sync means the deployment has no Supabase
  service-role key. Waiting does not fix it.
- **A 502 from every sync** on a deployment that redeems codes fine means the
  coverage migration is not applied (the store cannot write `tz_offset_sec`
  or `wearable_sync_days`). `scripts/apple-launch-check.mjs` names it.
- **Disconnecting Apple in Settings** deletes every stored day and covered
  day, but does not yet revoke the phone's device token, so the app's next
  background sync stores days again. Known gap, tracked in the launch notes;
  until it closes, the privacy page tells the player how to stop the app from
  the phone side.
- **Apple missing from the picker** with the store live means
  `APPLE_APP_AVAILABLE` is unset on that deployment; the providers route says
  so in its note.

### Who is worse off with Apple on

| Who | What they see | Worse off? |
|---|---|---|
| Apple player who misses, phone covered every day | Loses the stake, the same as a WHOOP player on the same challenge. Before coverage, Apple misses were always refunded. | **Yes, and deliberately.** The old behaviour was a money-fairness defect said nowhere in the UI. |
| Apple player who misses, phone skipped a day | Refunded, reason shown. | No |
| iPhone with no Apple Watch | Sleep challenges locked at pairing, the missing Watch named. Steps, distance, calories and workouts stay open. | **Yes, and deliberately**, before any stake. |
| Apple player on an app build older than coverage | Hits pay; misses refund until they update the app. | No |
| Player who paired a phone, then chose WHOOP on the web | Reads through WHOOP; the next phone sync does not flip them back. | No |
| Apple player on a deployment with the flag off | Apple hidden, read through the fallback provider, and the picker says "Apple Watch is not open on this build yet." | No, and never silent |

## Who is worse off after this change

Required by the product-correctness rule: state which users get a worse
experience, and what they see.

| Who | What they see | Worse off? |
|---|---|---|
| No wallet connected | Everything, unchanged. Capabilities are unknown, so nothing is held back. | No |
| Wallet, no device linked | Unchanged. Connect prompt plus a picker when more than one provider is configured. | No |
| Junction user, any supported goal | Unchanged. | No |
| WHOOP user, sleep or workout goal | Full path, same as Junction. | No |
| WHOOP user, steps or distance goal | Pool grouped under "your device cannot measure these", join withheld, reason given, one tap to change device. | **Yes, and deliberately.** They could previously join and would have been refused at the claim, after staking. |
| Any user, just linked | "Connected and has not sent anything yet" instead of a zero streak. | No, strictly better |
| Device that reports no sleep score, on a sleep-score pool | Pool is grouped as unmeasurable and the join is withheld, before any stake. Dashboard says the device does not report a sleep score. | **Yes.** Before, efficiency was silently substituted and they were judged on an easier bar. |
| Linked wallet whose device measures only some metrics (an iPhone with no watch, a scoreless tracker) | Only the pools their setup can actually prove are joinable. | **Yes, and deliberately.** Previously joinable, then refused at the claim. |
| Apple user with a Watch, any goal except sleep-score | Full path, equal to WHOOP: pays on a hit, loses the stake on a covered miss. | No, strictly better: Apple was hidden before |
| Apple user, iPhone and no Watch, sleep goal | Pool grouped as unmeasurable, join withheld, reason names the missing Watch. | **Yes, and deliberately.** Previously joinable, then refused at the claim after staking. |
| Apple user, any sleep-score pool | Refused at the join. Apple publishes no proprietary score. | **Yes.** Correct: there is no number to judge them on. |
| Apple user who tapped Pair and never installed the app | Reads as not paired, with the Get the app link and the code still on screen until it expires. Nothing is provisioned server-side beyond the code, so no state claims a connection that does not exist. | No |
| Apple user whose phone has not synced yet | "Open the GoHealthMe app on your iPhone, or wait for its next background sync", distinct from a zero and from a device that cannot measure it. | No, strictly better |
| Any user, provider outage | Unchanged: "cannot verify right now", kept separate from the permanent case. | No |

### Per-device capability, not just per-provider

A provider's declared metric list is the union of what its brands can do. It is
not always what a given person is wearing. Junction offers a proprietary sleep
score to a wallet whose tracker has none; a phone-based provider offers sleep to
somebody syncing steps from a handset with no watch nearby. In both cases the
provider legitimately declares the metric and that wallet can still never
satisfy a pool scored on it.

Apple answers this exactly and for free: the phone tells us which metrics it
computed, so the observed list is a query against our own table with no
upstream call and no cache staleness. An iPhone with no Watch has produced
steps and distance and no sleep, and the gate reads precisely that.

Two failure modes are worth stating because either one silently takes pools
away from somebody. A provider that returns an empty list when nothing has been
observed yet would blank a brand-new wallet's entire board, and one that
returns an empty list when its own query fails would narrow the gate for a
reason that has nothing to do with the user's device. Both cases must return
null and fall back to the declared list. Pinned by tests in
`lib/server/wearable/apple.test.ts` and `junction-provider.test.ts`.

So the gate prefers **observed** capability over declared. The provider backing
a wallet is probed once, cached for 30 minutes, and asked only whether each
number EXISTS for that wallet - not whether it was any good. The narrowed list
is what the pool list and pool page gate on.

Safeguards, because getting this wrong either hides somebody's board or
invites them onto a run they cannot win:

- **Superseded 2026-09-26 (QA item 11).** A Junction wallet that has observed
  nothing used to fall back to the declared list. That list is Junction's union
  across brands, so a WHOOP strap linked through Junction was offered steps
  runs until its first sync, staked, and failed closed at the claim. It is now
  an **awaiting-sync hold**: wearable runs stay locked with "your sensor has not
  synced yet, check again", re-probed on a 3 minute cache so a sync unlocks
  within minutes. Apple still falls back to declared on nothing observed (a
  single brand; its declared list is already device-accurate per metric).
- A metric counts as observed only on a day **above zero**. Junction can answer
  a WHOOP activity day with `steps: 0`; that zero is not a pedometer.
- Workouts count as measurable for any device that is syncing anything, on both
  Junction and Apple. A day with no workout is a real zero to the verdict, so a
  person who rested for two weeks is not told their hardware cannot count them.
- An upstream failure narrows nothing and offers nothing: a linked device the
  provider will not describe is an **unreadable hold** ("I cannot read your
  sensor right now"), never "pair a sensor".
- A hybrid pool (`[proof=wearable+self]` or `+doc`) stays joinable without a
  working wearable while the upload path is on; the gate returns
  `{ kind: "ok", proof: "upload" }` so the surface can say the photo or
  document is the proof for this player.

Apple is offered in the picker, and read by SPOTTER, only when
`APPLE_APP_AVAILABLE=1`. Offering Apple because the database exists once sent
beta users to install an app they could not get, so the flag follows the
TestFlight link, never the table. `/api/wearable/apple/sync` accepts days from
any paired phone whenever Supabase is configured, flag or not; the flag decides
whether those days are offered and judged.

WHOOP OAuth carries an in-app return path (`next`) through `/api/wearable/link`,
`/api/whoop/login` (httpOnly cookie) and `/api/whoop/callback`, validated at
each hop as a same-origin non-API path, so a connect started in character
creation or on a pool page comes back there with `?whoop=<outcome>`.

WHOOP is not probed: every strap is the same hardware, so its declared list is
already device-accurate and probing would spend requests against a shared daily
quota to re-learn a constant.
