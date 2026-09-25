# Sensor integrations for V4: overlap-only goals, WHOOP for two, Junction for everyone

Date: 2026-09-26. Status: design approved in conversation by Andre (sections 1 and 2); section 3 recommendation pending his review of this spec.

## Intent

Players must never meet a goal their sensor cannot verify, and the screen must stay simple. Hard rules that bind this design: seamless UX (no hidden prompts, no dead ends, no refusal after a stake) and real beta users, not a demo.

What Andre said:
1. WHOOP live for Andre and Nikki; Junction stays the path for everyone else.
2. Integrations right for the selected pool types.
3. Enforce less strictly and show a comparison without crowding the screen.
4. Apple later, through Nikki's Apple developer account.
5. When a device cannot measure a run: soft lock (dimmed run, one line, no stake button).
6. Only offer runs that all supported sensors can verify.

## 1. Launch goals: the overlap

A run is offered only if every supported provider can verify its metric.

| Goal | Junction | WHOOP | Apple | Launch |
|---|---|---|---|---|
| Sleep hours | yes | yes | yes, needs a Watch | yes |
| Workouts per day | yes | yes | yes | yes |
| Sleep efficiency | yes | yes | yes, needs a Watch | yes |
| Steps, distance, active calories | yes | no | yes | no |
| Sleep score | yes | yes | no | no |
| Heart-rate zone minutes | see section 3 | see section 3 | see section 3 | stretch |

Steps, distance, calories and sleep score stay in the code (existing V3 runs still settle); no new run is created with them.

## 2. Enforcement without new screens

1. **One source of truth.** `LAUNCH_METRICS` in `app/lib/wearable-providers.ts` is computed as the intersection of each provider's declared capability table, never a hand-kept list. Adding a provider or a metric updates it.
2. **Creation offers only launch goals.** `CreatePool`, `CreateChallenge` (dares), the sponsor console and the `/goal` matcher list only `LAUNCH_METRICS`. The create routes (`/api/challenges`, sponsor pool creation, the goal matcher) refuse any other metric server-side with a plain message.
3. **Lobby.** With overlap-only runs, no lock shows in the normal case. The existing soft lock remains only for per-device gaps: Apple without a Watch on a sleep run, a sensor awaiting its first sync, an unreadable device. One dimmed line and its fix; no stake button.
4. **Comparison on the pairing card, one line per sensor.** Example: "WHOOP · counts sleep, workouts, sleep efficiency". Generated from the same capability tables. No matrix on screen.
5. **WHOOP for two.** The WHOOP connect option renders only for wallets in `WHOOP_ALLOWED_WALLETS` (Andre and Nikki). Everyone else sees Junction, which also covers WHOOP straps, so no user can hit WHOOP's 10-member sandbox cap mid-OAuth. Env on V4: `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI=https://gohealthme-tokyo.vercel.app/api/whoop/callback` (registered in the WHOOP developer dashboard on 2026-09-26), `WEARABLE_TOKEN_KEY` (set). The server refuses a WHOOP link for a wallet not on the list.
6. **Live cleanup.** V4 pool 3 ("Walk 8k steps today", contract `0x0B6E8D47...A12F`) is not a launch goal and has no participants: cancel it on chain and seed a workouts or sleep-efficiency run in its place with `scripts/tokyo-deploy.sh`. Record both txs in `DEPLOYMENTS.md`.
7. **Junction** stays the default provider and needs its sandbox API key (Nikki). Until then the pairing card says Junction is not set up yet; the allowlisted two can pair WHOOP.

## 3. Heart-rate zone minutes (stretch, recommended to defer)

Research (2026-09-26, cited in the session): WHOOP exposes zone time only inside workouts (`score.zone_durations`, zones by % of heart-rate reserve), so the only definition all three can compute identically is **workout minutes with HR at or above 60% of heart-rate reserve** (WHOOP zones 2 to 5).

- WHOOP: sum zone two to five from workouts already fetched (`app/lib/server/wearable/whoop.ts:784-826`), about 1-2h.
- Junction: heart-rate timeseries inside each workout window, resting HR from sleep data; its `hr_zones` use a different basis and are not used. About 3-4h. Per-device coverage is not documented.
- Apple: new HealthKit heart-rate permission, samples inside workouts bucketed per local day on the phone. About 4-6h; needs a Watch and a device build.
- Total about 11-16h. Recommendation: build after WHOOP and Apple are live, and offer the goal only after each provider passes a real-device test. Not in the launch set.

## 4. Apple (separate sub-project, not in this spec)

The iPhone app (`mobile/`) posts daily aggregates; it has never run on a device. It ships through Nikki's Apple developer account (EAS build to TestFlight) and is gated by `APPLE_APP_AVAILABLE`. When it lands it joins the overlap automatically through section 2 point 1.

## Error handling

- WHOOP OAuth failure or denial: return to the pairing step with a plain retry line; nothing staked.
- Non-allowlisted wallet hitting the WHOOP link route directly: 403 with "WHOOP pairing is in private beta; use Junction", never a partial link.
- Creation of a non-launch metric via a hand-built request: 400 with the list of goals that are offered.
- A provider outage keeps the existing outage lock copy.

## Testing

- `LAUNCH_METRICS` equals the intersection of the capability tables; adding a metric to one table does not add it to the launch set.
- Each create route refuses a non-launch metric and accepts each launch metric.
- WHOOP option visible only to allowlisted wallets; link route refuses others.
- Pairing card one-liners generated from the tables.
- Browser drive on a phone: Andre pairs WHOOP, joins a sleep or workouts run, sees no lock; a non-allowlisted wallet sees only Junction.

## Out of scope

Heart-rate zone minutes (section 3), the Apple build (section 4), World payout confirmation redesign (sponsor ask A9).
