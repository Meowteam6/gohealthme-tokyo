# GoHealthMe V4 design system: Night Shift

Adopted 2026-09-26 by Andre over SPOTTER's Riverbank, after three directions were built as real mocks and judged (investor, player, designer). Every screen follows this file. When a screen disagrees with it, the screen is wrong. The approved mocks, art and state screenshots are listed in the Decisions log.

## Product context

- **What this is:** put your own (test) money on a health goal, your wearable decides, and the players who follow through split the stakes of the ones who do not (commitment model, carried from V3). SPOTTER, the settlement agent, reads the wearable's result; the run's contract holds and pays the money.
- **Who it is for:** people who want a reason to sleep and train, and friends who challenge each other. Mobile first.
- **Memorable thing:** **put money on yourself.** H1 "Put money on yourself." Sub "Stake on your sleep or workouts. Your wearable decides."
- **Stage:** beta on Base Sepolia test USDC. Never "live" or "production" in copy.

## Thesis

The run happens while you sleep, so the brand lives at night. The page is a deep indigo field with one warm light, the moon. SPOTTER sleeps on the top edge of the real run card, which acts as the horizon, and gold appears only on money. The first screen is the product: the headline, the live run card with exact numbers, and the action inside that card. Every limit shows before a stake, and nothing on the page promises something the chain does not do.

## Tokens (`app/app/globals.css`)

Dark only for now. Every colour is a semantic CSS variable; components never hard-code a hex. **A light theme is one more block** that redefines the same variables under `:root[data-theme="light"]` (plus `color-scheme: light`); nothing else changes. The few consumers that cannot read CSS variables (the share card, the viewport theme colour) read `lib/night-palette.ts`, which a test keeps equal to `globals.css`.

| Token (Tailwind name) | Value | Role |
|---|---|---|
| `--surface-deep` (`surface-deep`) | `#070C20` | Footer, inputs, deepest |
| `--background` | `#0B1330` | The page |
| `--surface` | `#111B3D` | Cards (`--surface-top` `#16214A` is the lit top edge) |
| `--surface-raised` | `#18244D` | Chips, wells, SPOTTER's caption box |
| `--border` (`edge`) / `--border-strong` (`edge-strong`) | `rgba(214,222,255,.10)` / `.18` | Hairlines |
| `--fill-quiet` / `--fill-quiet-hover` | `rgba(214,222,255,.06)` / `.10` | Secondary buttons, chips, rows over a card |
| `--foreground` | `#F3EBDD` | Primary text (15.4:1) and the moon face |
| `--muted` | `#C4CAE0` | Secondary text (10.3:1 on a card) |
| `--haze` | `#8F98B8` | Meta text (5.9 on a card, 5.3 on raised) |
| `--accent` / `--accent-top` / `--accent-bottom` | `#F3EBDD` / `#FBF5EA` / `#E9DFCC` | The moon face gradient on primary buttons |
| `--accent-foreground` | `#0B1330` | Ink text on the moon face |
| `--accent-deep` | `#C4CAE0` | Links; always underlined or chevroned, never colour alone |
| `--gold` | `#F5B94A` | **Money only**: stake figures, pots, payouts, the hold ring (9.6 on a card) |
| `--moonlight` | `#F6E4B6` | The moon, tags, "Hit" status, the sleep block, banked nights |
| `--dusk` / `--dusk-ink` | `#7C85A6` / `#8F98B8` | A miss and 0.00, never red. Dusk is 4.6 on a card; on raised use dusk-ink |
| `--danger` | `#F4A3A3` | Real form and transport errors (8.5 on a card) |
| `--warning` | `#DCE1F2` | Locks and outages: neutral on purpose, stated plainly with an icon |
| `--paper` / `--ink` / `--ink-2` | `#F3EBDD` / `#0B1330` / `#4A5372` | The receipt (ink-2 is 6.4 on paper) |
| `--otter` | `#3FAF8E` | SPOTTER's art and the brand mark only, never UI |

Radii: `rounded-control` 14px, `rounded-card` 22px, `rounded-tag` 8px (legacy `rounded-xl/2xl/3xl` land on 14/18/22). Depth utilities: `shadow-card`, `shadow-card-hero`, `shadow-moon`, `shadow-moon-pressed`, `shadow-secondary`, `shadow-selected`, `shadow-paper`. Gutter: `px-gutter` (16px phone, 32px from 768px). Page column 1200px. Film grain and the top sky glow sit on `body`; `body.lights-out` dims the glow to 35% after a stake.

Deleted with Riverbank: coral, the 4px slab shadow (`--shadow-pop*`), `--accent-strong`, board/chalk night panel, Patrick Hand and `--font-hand`, backdrop art, speech bubbles.

## Type

- **Fraunces** (variable, SOFT 50, WONK 0, weight 560) sets words: the H1, section titles, the wordmark, "of sleep, Saturday night", verdict headlines, "You're in. Goodnight." Use the role utilities, size at the call site:
  - `type-display` (opsz 144): H1, 44px phone, 80px from 900px.
  - `type-title` (opsz 96): section titles, 32 / 48.
  - `type-heading` (opsz 72): card and verdict headlines, 26 to 30.
  - `type-wordmark` (600, opsz 36): "GoHealthMe".
- **Figtree 400 to 700** sets all UI text and **every number**, including the one big figure ("7 hours", 60px phone, 112px desktop). Money uses `.num` (lining, tabular).
- Words in the serif, numbers in the sans. **Geist Mono** only for tx hashes and addresses. No all-caps labels, no handwriting face.

## SPOTTER on a night field

Only eight relit poses may stand on the indigo field: `sleep`, `wearable`, `wave`, `thumbsup`, `meditate`, `detective`, `facepalm`, `thinking`. They live in `app/public/spotter/night/`, re-matted and relit by `app/scripts/relight-spotter.mjs` (`node scripts/relight-spotter.mjs`; never writes into `public/spotter/`). `lib/spotter-poses.ts` resolves any older pose name (payday, greet, cheer, a baked-background card) to the night pose with the same meaning, so none of them can reach the page.

One pose per viewport, **always standing on a card's top edge with a contact shadow** (`<Perch>`). His lines go in his caption box (`SpotterCaption`), never a comic bubble.

| Surface / state (`SpotterScreenState`) | Pose | Width phone / desktop |
|---|---|---|
| Landing hero (`landing-hero`), breathing, in front of the moon | `sleep` | 176 / 280 |
| Landing hero after a tap (`landing-woke`), "I watch your wearable, not your wallet." once | `wave` | 74 / 118 |
| How a run pays (`outcome-hit` / `outcome-miss` / `outcome-none`) | `thumbsup` / `facepalm` / `meditate` | 92 / 116 |
| Run page before joining (`run-open`) | `wearable` | 96 / 176 |
| Run page after joining (`run-joined`), "You're in. I'm asleep till 08:30. You should be too." | `sleep` | 132 / 260 |
| Verdict: confirm with World ID / denied or expired / lost (`verdict-confirm` / `verdict-denied` / `verdict-lost`) | `detective` / `thinking` / `facepalm` | 96 / 176 |
| Verdict paid (`verdict-paid`), on the paper receipt | `thumbsup` | 84 |

Motion for him: he breathes only while asleep (5.2s, scale 1.006 x 1.018).

## Components

All in `app/components/ui.tsx` and `app/components/spotter/`. Server-safe unless marked client.

- **Button** `({ variant?: "primary" | "secondary" | "tertiary", size?: "md" | "sm", block?: boolean, ...button })`. Primary is the moon: cream gradient, lit top edge, 2px inner bottom shade, soft glow, ink text. Secondary is a faint fill with an inset hairline. Tertiary is an underlined text action, still 44px. md 52px, sm 44px, radius 14. Press is a 0.98 scale over 90ms; never an offset slab. Disabled drops to the quiet fill with haze text (a dimmed moon reads as broken). Legacy `ghost` renders secondary, `coral` primary.
- **buttonClasses** `({ variant, size, block }) => string` for anything that is not a `<button>`; **ButtonLink** is a `next/link` with the same look; **ChevronLink** is "See all 3 open runs >"; **TEXT_LINK** is the inline underlined link class; **FOCUS_RING** the shared focus outline.
- **Chip** `({ selected, role?, ...button })`: 44px, quiet fill with hairline, the moon face when selected. `role="radio"` inside a `role="radiogroup"` reports `aria-checked`; otherwise `aria-pressed`.
- **Tag** `({ tone?: "live" | "ended" | "muted", dot?, children })`: "Open tonight" in moonlight with a dot.
- **Card** `({ as?, variant?: "default" | "hero" | "flat" | "raised" | "paper", padding?: "md" | "sm" | "none", ...div })`. Default is the lit card, hero the run card (moonlight hairline on top), flat a row, raised a well inside a card, paper the receipt.
- **StatRow** (a `<dl>` with hairline dividers; three stats split 1.1 / 1.1 / 0.8) and **Stat** `({ label, value, unit?, tone?: "default" | "money" | "dusk", size?: "md" | "lg" })`.
- **RunCard** `({ id?, tag?, ends?, title, titleAs?, stats?, note?, action?, fine?, children? })`: the hero run card shell. Slots only; the caller brings live numbers.
- **Fine** small print (13px haze). Test money and beta always appear twice: under the money action and in the footer.
- **BrandLockup** mark plus wordmark, linking home. The mark is `public/brand/mark.svg` (`app/icon.svg`, `app/apple-icon.png`, `app/favicon.ico` from the same file).
- **Money** `({ usd, sign?, size? })` gold, tabular. **Verdict**, **Stamp** `({ tone?: "accent" | "danger" | "ink" })` (sentence case, flat), **Badge**, **ErrorNote** `({ title, detail?, raw?, onRetry?, retryLabel? })`, **EmptyState** `({ title, detail, action?, pose?, line? })`, **Skeleton**.
- **Spotter** `({ pose | state, width?: number | [phone, desktop], size?, line?, linePlacement?, decorative?, alt?, priority?, contact?, breathe? })`. **SpotterFigure** is the bare art plus contact shadow.
- **Perch** `({ pose | state, width?, side?: "left" | "right", inset?, overlap?, reserve?, children })`: SPOTTER standing on the wrapped card's top edge; reserves his height so nothing overlaps. Give side-by-side cards the same `reserve` so their tops line up.
- **SpotterCaption** `({ line, live?, label? })`: his caption box.
- **Moon** `({ diameter?: number | [phone, desktop], id?, className })`: the one warm light; the caller positions it.
- **HoldCoin** (client) is the hold button: the moon primary at 60px with an ink disc, a USDC glyph, a gold conic ring and a gold tint that fills left to right over 1.2s. Space or Enter commits; "Tap to confirm instead" opens an inline confirm (`confirmPrompt`, `confirmLabel`, "Not now"); status is announced through `aria-live`. Waiting states (balance check, wallet, in flight) drop to the quiet fill. Props: `onCommit, label, hint?, tapLabel?, confirmPrompt?, confirmLabel?, committedHint?, disabled?, disabledReason?, durationMs?`. Logic in `hold-commit.ts` (node-tested); commits once per mount, remount with a new `key` to retry.

### Chrome

- **Header:** transparent over the page, then `--header-scrolled` with a 14px blur once scrolled, so nothing shows through it. Signed out: brand, Runs and How it pays (from 640px), Sign in. Signed in: Lobby, My runs, History, Challenges, Settings inline from 1024px, otherwise a menu that also carries the wallet name, copy-address and the test USDC chip. **No status strip**: SPOTTER's line appears under the bar only while checks are paused (he is out of check money).
- **Footer:** the deepest field, brand, the beta and privacy line, Runs, How it pays, About SPOTTER, Privacy, Terms.
- **Helper bubble:** never on the landing or a run page.
- **Sign-in:** Dynamic's own modal, themed dark (`theme="dark"`, `--dynamic-*` variables on `.dynamic-shadow-dom`, one `cssOverrides` rule for ink text on the moon brand button). World's IDKit widget as is.

## Layout

- Phone first at 360 to 390px, 16px gutters, no horizontal scroll, 44px targets. Wide layouts switch at 900px (landing) and 960px (run page).
- The landing's first viewport holds the H1, the run card with exact numbers, and its action. The run page's hero is the one big figure ("7 hours") with the stake card beside it on desktop and a phone hold bar once the card's own action scrolls away.
- Nights are pebbles: moonlight when banked, outlined to play, dim when they can no longer count, always with "1 of 2 nights banked" written next to them.

## Motion

Feedback, never decoration. The moon's glow fades in once (900ms). Hold fill 1.2s, header 160ms, sheet 180ms, tabs and chips 120ms. After staking the page glow dims ("lights out"). No confetti, no fade-ins as sections scroll. `prefers-reduced-motion` turns every animation off and the screens read the same.

## Voice

- Say stake, put money on yourself, run, pot, challenge. **Never bet, wager, odds, luck, winner** (hard rule). Players see "wearable", never "sensor"; "challenge", never "dare".
- SPOTTER is the referee who reads the wearable. **The contract holds the money**; he never claims to hold it.
- Money, verdict and health-data copy is plain and exact. No plumbing reaches the player.
- No emojis, no exclamation marks. Buttons are verbs with objects: "Put 1 USDC on myself", "Hold to stake 1.00 USDC", "Add free test USDC", "Pair a different wearable", "Challenge a friend into this run", "Go again tonight".

## States

Every stateful component renders default, loading, empty, error, success and disabled; the run page adds guest, zero balance, locked, pending, failed and joined; the verdict adds confirm, paid, denied or expired, lost. A disabled control says why. A lane that is off on this deployment is a state, not an error.

### State gallery (`/dev/states`)

Dev only. On any production build (previews included) a `beforeFiles` rewrite in `app/next.config.ts` sends `/dev/*` to a path no route matches, a real 404; the page also calls `notFound()` in production as a second guard. Run `NEXT_PUBLIC_ACCESS_GATE_DISABLED=1 npx next dev -p <port>` (never write that flag to a file) and open `/dev/states`, `/dev/states?only=<section>` or `/dev/states?only=<section>#<state>`.

- Each screen owns one file in `app/app/dev/states/_sections/` (foundation, landing, run, verdict, lobby, shell, onboarding, challenges). The registry (`_sections/index.ts`) already lists them, with their id, title and owner, so filling a section never touches another file.
- A section component takes `{ meta }: SectionProps` and returns `<GallerySection meta={meta}>` with one `<StateFrame name="run-zero-balance" note="..." phone?>` per state. Names are kebab-case, unique, prefixed by the screen. Add `"use client"` to the section file when a state needs local state or handlers.
- Render the real components with fixture props. Numbers come from `lib/commitment.ts`, never typed.

## The commitment model

This is the product's money rule and its compliance line, so every run with `bountyModel` 2 says it in plain words, before any stake. It mirrors `HealthPoolsV3._settleCommitment`.

- **Everyone puts in the same stake.** Your result depends only on your own effort, verified by your wearable, never on chance.
- **Hit your goal:** your own stake comes back, plus an equal share of the stakes of players who missed, plus any sponsor pot.
- **Miss (your wearable shows it):** your stake goes to the players who hit.
- **No wearable data for the run:** your stake comes back.
- **Nobody hits:** everyone gets their stake back.
- **No cut on V4:** `commitmentFeeBps()` is read from chain; "No cut on this build" shows only when it reads 0.
- **Test money:** "Test USDC during beta" under the action and in the footer. Lead with "your stake back", never a prize.

**Rule: numbers come only from `app/lib/commitment.ts`** (`commitmentOutcome`, `commitmentRange`) and wording from `app/lib/game/commitment-copy.ts` and `app/components/CommitmentTerms.tsx`. No component does its own payout arithmetic.

| Where | What it says | Source |
|---|---|---|
| Landing | Outcome tabs (hit, miss, nobody hits) with this run's worked number | `commitmentOutcome`, `CommitmentBeats` until the tabs land |
| Create run, create challenge | Range line under the stake field | `CommitmentRangeLine` |
| `/c/[token]` | The terms list before accepting | `CommitmentTermsList` |
| Lobby row | "Stake 1.00, get it back plus a share if you hit" | `commitmentRowTerms` |
| Run page | The terms with this run's live count and pot, before the hold button | `HowThisRunPays`, `CommitmentTermsList`, `feeLine` |
| Under the hold button | One range line: hit, miss, nobody hits | `CommitmentRangeLine` |
| The run | "If you hit" range and the three outcomes | `hitRange`, `COMMITMENT_REMINDER` |
| Verdict, paid | Stake back plus share, split from the amount the settle credited | `paidBreakdown` |
| Verdict, not met | What the chain recorded (miss to the hitters, nobody hit, or refunded) | `commitmentLostCopy` |

Known gap, stated so nobody overclaims: the contract refunds a player whose result was never recorded (B-2), so a miss only goes to the players who hit once SPOTTER records `verdict=false` on chain (being wired on `fix/record-misses`). Until that lands on a deployment, forward copy must not promise the stricter rule; the verdict always states what actually happened.

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-26 | Replaced the "bet with your boys" scoreboard system with SPOTTER's Riverbank | Andre: the UI was plain and the otter barely used. Revert: tag `pre-redesign-2026-09-26`. |
| 2026-09-26 | Memorable thing: put money on yourself, commitment model | Andre. Worded as stake, never bet (hard rule). |
| 2026-09-26 | "Dare" renamed to "challenge" everywhere players see it | Andre: dare read too aggressive. Routes and identifiers keep the old names. |
| 2026-09-26 | **Night Shift adopted by Andre over Riverbank.** Dark only for now; a light theme comes later by redefining the same tokens under `[data-theme="light"]` | Andre rejected Riverbank as unfundable (painterly backdrops, coral slabs, the product not in the first viewport). Three directions were mocked and judged; Night won on memorability and on telling the story (the run happens while you sleep) with no jargon, with River Ink's funnel (action inside the hero run card, sign-in that returns to the run, zero-balance faucet step, phone hold bar) and Arcade's character work (outcome tabs, tap-to-wake SPOTTER, a fit line that names the limit) grafted on. Mocks, art and state screenshots: `directions/final/` in the design session scratchpad (landing.html, run.html, art/, state-*.png). |
| 2026-09-26 | Foundation: tokens, Fraunces + Figtree, relit poses, primitives, dark Dynamic modal, `/dev/states` | Branch `design/night-shift`. Every hand-rolled coral button moved onto `buttonClasses` (the token flip made cream text on a cream face). SPOTTER's run-page line no longer says he holds the stake. |
| 2026-09-26 | Run pages readable signed out, gated again once signed in | "Put 1 USDC on myself" must land on the run, not a wall. A signed-in player who has not proved they are one person goes through character creation before the hold button is in front of them, so nobody is refused at the stake. Server still enforces `isAllowed`. |
| 2026-09-26 | Header status strip removed; SPOTTER's line shows only during an outage | The strip was operator chrome on every screen. The outage is a real limit before a stake, so it stays, under the bar, only while true. |
