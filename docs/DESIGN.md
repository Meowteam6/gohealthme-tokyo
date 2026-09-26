# GoHealthMe V4 design system: SPOTTER's Riverbank

Adopted 2026-09-26 through a design consultation with Andre (research on commitment, mascot-led and wearable apps, plus an independent direction proposal). It supersedes the "bet with your boys" scoreboard system; that version is recoverable at git tag `pre-redesign-2026-09-26`. Every screen follows this file. When a screen disagrees with it, the screen is wrong. Preview built from the real art: see the Decisions log.

## Product context

- **What this is:** put your own (test) money on a health goal, your wearable decides, and the players who follow through split the stakes of the ones who do not (commitment model, carried from V3). SPOTTER, the settlement agent, checks and pays.
- **Who it is for:** people who want a reason to sleep and train, and friends who dare each other. Mobile first.
- **Memorable thing:** **put money on yourself.** Every decision below serves it.
- **Project type:** consumer web app with game feel. Beta on Base Sepolia test money.

## Point of view

**SPOTTER holds your stake.** Real sea otters keep a favourite rock in a skin pouch under the arm. Your stake is a coin SPOTTER tucks into his pouch; the verdict is him handing it back with the pot, or not. The app is his riverbank at golden hour: warm, painterly, a little smug. The character is loud; money, verdicts and anything about health data are plain and exact.

The player meets these screens, in order, never a wall in between: character creation (once), the Lobby, putting money on a run, the Run, the Verdict. Limits show as a lock on the lobby row with its fix, before a stake, never after.

## SPOTTER (the mascot is the layout)

SPOTTER is not an avatar in a corner. On key screens he takes 50 to 65 percent of the viewport and the UI is props he holds (coin, magnifier, wallet). One pose per state, including the bad ones; never an error icon where SPOTTER can react. Art lives in `app/public/spotter/` (32 transparent poses plus `backdrop.png` and `spotter-thedrop.mp4`); serve them as WebP or AVIF at 2x before any full-bleed use on mobile.

| State | Pose | Size |
|---|---|---|
| Onboarding step 1 to 4 | `wave`, `peek` (World ID), `point` (name), `wearable` (pair) | about 60vh over `backdrop` |
| Lobby | `peek` from the bottom edge | about 120 to 170px |
| Locked run row | `detective` inline, with the reason and the fix | 40 to 56px |
| Putting money on yourself | `payday` holding the pouch, above the coin | about 70% width |
| The run, day | `watching` | about 160px |
| The run, night on a sleep goal | `sleep` in the night panel | about 170px |
| The run, workout goal | `lift` or `run` | about 160px |
| SPOTTER checking, screening | `detective`, `screening` | about 50vh |
| Verdict, paid | `payday` full bleed, coin flips out of the pouch | about 65vh |
| Verdict, not met | `facepalm` on a dusk wash | about 50vh |
| Declined or expired confirmation | `thinking` or `neutral`, honestly let down | about 45vh |
| Empty states | `lounging` ("Nothing running. I'm on break.") | about 200px |
| Settings / wallet | `wallet` | about 160px |
| History | `detective` or `verified` per entry type | 40px per row |

Teal (`#3FAF8E`) belongs to SPOTTER alone so he always pops; nothing else in the UI is teal.

## Tokens (`app/app/globals.css`)

Keep the semantic token names so existing components re-theme; the values change.

| Token | Value | Role |
|---|---|---|
| `--background` | `#F6EFDF` | Meadow cream (his belly). Warm, never grey. |
| `--surface` | `#FFFBF2` | Cards and rows on the cream. |
| `--surface-raised` | `#EDE2CA` | Pressed, locked or secondary rows. |
| `--border` | `#E2D6BB` | Hairlines. |
| `--foreground` | `#0F2A2E` | River ink. Text and night panels. |
| `--muted` | `#4E5E5F` | Secondary text; passes AA on cream and surface. |
| `--accent` | `#F2764F` | Coral nose. Primary actions only. **Ink text on it** (about 6:1), never white. |
| `--accent-strong` / `--accent-deep` | `#D95E38` / `#1E6F6A` | Button press shadow; deep pond for links and text on tint. |
| `--gold` / `--gold-deep` | `#F5B82E` / `#8A6200` | Money only: stakes, pots, payouts, the coin, banked pebbles. Deep gold for money text on cream. Never a verdict colour, never decoration. |
| `--dusk` | `#6B7A8F` | A lost run. Wash and text. Never red for a loss. |
| `--danger` / `--warning` | `#C8283A` / `#9A4A00` | Real errors and locks only, not losses. |
| `--otter` | `#3FAF8E` | SPOTTER only. |

Radius: 16 to 20px on cards and rows, 18px on buttons, pills stay pills. Primary buttons carry a 4px solid `--accent-strong` bottom shadow (pressable toy, not a gradient). No purple, no gradients on buttons, no decorative blobs.

## Type

- **Display and numbers:** Bricolage Grotesque 800 (500 and 700 for smaller headings). Tight, `letter-spacing: -0.02em` to `-0.03em`, line-height 0.9 to 0.95, tabular numbers. Screen titles, stake and payout figures, the night count, the verdict headline.
- **Body and UI:** Atkinson Hyperlegible Next 400 / 500 / 700. All running copy, buttons and labels; built to be read at 1am with one eye open.
- **SPOTTER speaks:** Patrick Hand, only inside SPOTTER's speech bubbles and his one-liners. Never for money, verdicts or instructions.
- **Mono:** Geist Mono for addresses and tx hashes only.
- Load through `next/font/google` in `app/app/layout.tsx`. Scale: 13 / 16 / 20 / 28 / 40 / 64. Sentence case; no all-caps eyebrows (stamps like CONFIRMED are the one exception).

## Layout

- Phone first at 360 to 390px with 16px gutters. Play screens widen to about 44rem on desktop; the lobby goes two-up past 1024px.
- **One big number per screen** (the WHOOP rule): the run shows tonight's figure, the verdict shows the payout, the lobby shows stake to pot per row.
- **Nights are pebbles:** one per night the goal needs; a banked night is a gold pebble, a night to play is outlined, a night that can no longer count is greyed. "1 of 2 nights banked" is always written next to it.
- **Night panel:** after dark on a sleep run, the countdown sits in a river-ink panel with SPOTTER asleep in it.
- Lobby rows over cards: goal, stake to pot, time left, status; the lock reason and fix inline.

## Interaction

- **Hold to commit:** putting money on a run is a press and hold on the coin for 1.2s; a ring fills and SPOTTER pockets it. No confirm popup. Always pair it with a plain "Or tap here to confirm" control and keyboard Enter/Space, so no one is locked out.
- **Celebration only at the verdict.** Joining stays calm and serious. The payout gets the show: coin flips out of the pouch, a gold wash, then the exact money sentence.
- SPOTTER is tappable for a small reaction where it does not block a control.

## Motion

Intentional, never ambient. Coin pocketed (about 300ms), a pebble turning gold (160ms), the verdict stamp (160ms) and the coin flip on a payout (about 1.2s). Everything else is still. `prefers-reduced-motion` turns motion off and the screens read the same.

## Voice

SPOTTER is deadpan and dry, first person, with fixed lines per state (`lib/spotter-lines.ts`) so a judge sees the same sentence twice. The dry joke is aimed at the night or the situation, never at the player.

- Money, verdict and health-data copy is plain and exact. "The goal was 7 hours, so this run pays nothing. Your 1.00 USDC stays in the pot for the people who slept."
- **Stake on yourself, put money on yourself, a run, a dare, the pot.** Never bet, wager, odds or gamble (hard rule).
- No plumbing reaches the player: no env var names, raw provider strings or internal errors. A lane that is off says "not switched on for this build" and keeps going.
- Players see "wearable", never "sensor".
- Testnet stays visible ("Base Sepolia test money · beta"); V4 is beta on testnet, never "production".
- No emojis, no exclamation marks. Buttons are verbs with objects: "Put money on yourself", "Pair my wearable", "Run it back", "See the receipt", "Claim my USDC".

## States

Every game component renders default, loading, empty, error, success and disabled. Each has a SPOTTER pose or a line. A disabled control says why next to it. A lane that is not on this deployment is a state, not an error.

## Decisions log

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-26 | Replaced the "bet with your boys" scoreboard system with SPOTTER's Riverbank | Andre: the UI was plain and the otter barely used; the UI has to draw users as much as the product. Research: no stake app owns a mascot (Duolingo and Finch show the pattern); celebrate the verdict, not the deposit (Robinhood 2021). Preview: `docs/design/riverbank-preview.html` built from the real poses, approved. Revert: tag `pre-redesign-2026-09-26`. |
| 2026-09-26 | Memorable thing: put money on yourself, commitment model | Andre. Worded as stake, never bet (hard rule). |
| 2026-09-26 | Cut Big Shoulders, Barlow, cobalt, concrete paper, slip shadows, 8px radii | Scoreboard lettering fights a plush 3D otter. |
