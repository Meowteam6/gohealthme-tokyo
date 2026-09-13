# Wearables: turning a provider on

Everything an operator needs to take the wearable path from a fresh checkout to
a working connect, without reading the code. Covers the WHOOP-direct path and
the shared plumbing. The Apple Health path is documented separately by the
lane that owns it.

## What each provider can actually verify

A pool is scored on one metric. A provider that cannot measure that metric is
refused **at the join**, with the reason on screen, before any entry fee is
paid. This table is the source of that behaviour.

| Metric | Junction | WHOOP direct |
|---|---|---|
| `sleep_score` (proprietary 0-100) | yes, if the linked device produces one | yes |
| `sleep_efficiency` (asleep / in bed) | yes | yes |
| `sleep_hours` | yes | yes |
| `workouts` (sessions per day) | yes | yes |
| `steps` | yes | **no** |
| `distance_km` | yes | **no** |
| `active_calories` | yes | **no** |

The three WHOOP gaps are physical or semantic, not scope decisions:

- **steps** - a WHOOP strap has no pedometer. There is no number to read.
- **distance_km** - WHOOP records distance only inside a logged workout. Serving
  it would pass a runner and silently fail a walker on the same goal.
- **active_calories** - WHOOP reports total energy expenditure including basal
  metabolism, roughly 2500 kcal for an adult who did nothing. Junction's number
  is active calories, a few hundred. Reporting one as the other would clear a
  500-calorie goal every day without the user moving.

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
| Any user, provider outage | Unchanged: "cannot verify right now", kept separate from the permanent case. | No |

### Per-device capability, not just per-provider

A provider's declared metric list is the union of what its brands can do. It is
not always what a given person is wearing. Junction offers a proprietary sleep
score to a wallet whose tracker has none; a phone-based provider offers sleep to
somebody syncing steps from a handset with no watch nearby. In both cases the
provider legitimately declares the metric and that wallet can still never
satisfy a pool scored on it.

So the gate prefers **observed** capability over declared. The provider backing
a wallet is probed once, cached for 30 minutes, and asked only whether each
number EXISTS for that wallet - not whether it was any good. The narrowed list
is what the pool list and pool page gate on.

Two safeguards, because getting this wrong would hide somebody's whole board:

- A wallet that has observed **nothing** narrows to nothing at all. A person who
  linked ten minutes ago falls back to the declared list rather than being told
  their brand-new device measures none of these.
- An upstream failure narrows nothing. A provider hiccup can never take pools
  off the board.

WHOOP is not probed: every strap is the same hardware, so its declared list is
already device-accurate and probing would spend requests against a shared daily
quota to re-learn a constant.
