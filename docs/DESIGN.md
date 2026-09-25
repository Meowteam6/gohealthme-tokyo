# GoHealthMe V4 design system

Decided before the first V4 component (UX lane, ETHGlobal Tokyo 2026). Every screen in the game loop follows it. When a screen disagrees with this file, the screen is wrong.

## Point of view

**Bet with your boys, honestly.** The product is a dare with your own money: you put a stake down, a sensor decides, you get paid or you do not. That is already a game, so the UI is a scoreboard in a bar and a slip in your pocket, not a SaaS dashboard. The wrapper is loud; the money, the verdict and anything about health data are plain and exact.

The player meets four screens, in this order, and never a wall in between:

1. **Character creation** (once): sign in, prove you are one human, pick your name, pair your sensor. The result is a character card that every later screen reads.
2. **The Lobby** (`/pools`, `/c/[token]`): every run marked playable or locked for your device, with the reason and the fix. Limits surface here, before a stake.
3. **The Run** (`/dashboard`): the scoreboard for each run you are in. Nights banked, tonight, who is still in, time left.
4. **The Verdict** (inside the pool page): SPOTTER checks, you confirm you are you, the payout is screened, you win or you do not, and the screen says which in plain words.

Gate logic is evaluated once and shown as state. A refusal is a lock on the lobby row with its fix, never a new screen after the player committed something.

## Tokens (`app/app/globals.css`)

Semantic names are unchanged so every existing component re-themes with the values; only the values below moved.

| Token | Value | Role |
|---|---|---|
| `--background` | `#ECEEF1` | Concrete paper. Cool, never cream. |
| `--surface` / `--surface-raised` | `#FFFFFF` / `#F5F6F8` | Slips and rows sit on the paper. |
| `--border` | `#D3D8DF` | Hairline between slips. |
| `--foreground` | `#0D1B2A` | Navy ink. Text, and the scoreboard panel. |
| `--muted` | `#4F5D6F` | Secondary text, passes AA on paper and surface. |
| `--accent` | `#2346D8` | **The one accent.** Varsity cobalt. Primary actions, playable state, the human stamp. White text on it passes AA. |
| `--accent-strong` / `--accent-deep` | `#1834B0` / `#0E1F6B` | Hover and text-on-tint. |
| `--gold` family | `#FFC93C` / `#8A5E00` | Money only. Bulb yellow for stake and prize on the scoreboard; deep gold for money text on paper. Never a verdict, never decoration. |
| `--danger` / `--warning` | `#C8283A` / `#9A4A00` | Semantic states, not accents. Locked rows use warning; a lost run uses ink, not red. |
| `--coral` | = accent | Retired as a second accent. Kept as an alias so old call sites do not break. |
| `--shadow-pop` | `0 3px 0 0 var(--foreground)` | A printed-slip offset, not candy. |

Radius tightens globally through the Tailwind theme (`--radius-xl/2xl/3xl` down to 8/10/12px): slips and tickets, not bubbles. Pills stay pills.

## Type

- **Display and numbers:** Big Shoulders (700 to 900, the variable family that replaced Big Shoulders Display). Chicago scoreboard lettering. Used for screen titles, stake and prize figures, the night count and the verdict headline. Numbers are tabular.
- **Body:** Barlow (400 to 600). A plain grotesque with a little sports-programme flavour. All running copy, buttons, labels.
- **Mono:** Geist Mono, only for addresses, tx hashes and the existing `Money` primitive. Never for labels.
- Scale: 14 / 16 / 20 / 28 / 44 / 72. Headlines are set tight (line-height 0.95) and never mixed-colour. Sentence case everywhere; no all-caps eyebrows above headings.

## Layout

- Phone first at 390px with 16px gutters; desktop is the same column widened to 44rem for play screens, with the lobby going two-up only past 1024px.
- **The scoreboard** is the one bold element: a navy panel with bulb-yellow figures for prize and stake, chalk-white for time left and nights. It appears on the run and at the top of a lobby row's detail. Nothing else on a screen competes with it.
- **The night tally** is a row of boxes, one per night the goal needs: filled ink square for a banked night, outlined for a night still to play, struck through for a night that can no longer count. "3 of 5 banked" is always written next to it in words.
- Rows over cards in the lobby: a run is a slip (goal, stake to prize, time left, status) with the lock reason inline.

## Motion

Only where it means something. A banked night stamps in once (160ms). The verdict headline stamps in once. Everything else is still. `prefers-reduced-motion` turns both off and the screens read the same.

## Voice

SPOTTER is deadpan and dry (`lib/spotter-lines.ts`). The game screens use fixed SPOTTER lines per state (not random picks) so a judge sees the same sentence twice. Rules:

- Money, verdict and health-data copy is plain and exact. "Run lost. The goal was not met, so this run pays nothing." Never softened, never hyped.
- No plumbing reaches the player: no env var names, no raw provider strings, no "unexpected response", no "Stopped before payout". A deployment that lacks a lane says "not switched on for this build" and keeps going.
- Testnet stays visible (the "Base Sepolia test money" slip marker) and the stage word stays honest: V4 is in beta on testnet (CLAUDE.md hard rule, 2026-09-26), never "production", with the ETHGlobal Tokyo origin in the footer.
- No wager or odds language. It is a stake on yourself, a run, a dare. No emojis, no exclamation marks.
- Buttons are verbs with objects: "Pair my sensor", "Check my sensor", "Enter the run", "Claim my USDC", "Take my stake back".

## States

Every game component renders default, loading, empty, error, success and disabled. A disabled control says why next to it. A lane that is not on this deployment is a state, not an error.
