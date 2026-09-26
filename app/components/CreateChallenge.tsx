"use client";

// Create a challenge. Two honest variants, one screen, one clear choice:
//
//   STAKE ON YOURSELF (commitment) — you put your OWN USDC on your OWN goal.
//     Hit it, your stake comes back plus a cut of what everyone who flaked
//     forfeited. Nobody hits, everyone is refunded. This is the pilot model.
//
//   DARE A FRIEND (reward) — you put up a reward for someone else. They stake a
//     small lock-in to accept, hit the goal, and collect their lock-in back plus
//     your reward. They flake and the pool has no winner, everyone is refunded
//     and your reward comes back to you. A gift with skin in the game, never a
//     bet you win when they lose.
//
// Both variants create the SAME on-chain object: a commitment pool
// (bountyModel 2) through the SAME useUsdcDeposit -> createPool funnel the
// sponsor flow ships, so the F-1 dead-pool guard and the Blink swap point both
// still apply. The ONLY on-chain differences between the two are which USDC the
// creator puts in at creation (a reward for DARE, nothing for SELF — the stake
// is pulled on join) and who the goal is for.
//
// WHY MODEL 2 FOR BOTH — COMPLIANCE LANE (do not deviate): a commitment pool
// only ever routes a forfeited stake to a PEER ACHIEVER (someone who hit their
// own goal), and refunds every staker when nobody hits. The creator can sweep
// their own untaken reward but never a participant's forfeited stake, so the
// creator never profits from a participant failing. That is the DietBet /
// commitment lane, not a peer-wager. Model 1 (the old challenge model) would let
// the creator sweep a missed friend's stake and is not used here. Model 1 was
// also simply broken on the deployed contract: it created pools with a zero
// entry fee, which now reverts DEAD_CONFIG (the contract requires every player
// to be a staker), so no challenge could be created at all.
//
// PRIVACY: the goal ("lose 10 lbs") is health-adjacent. It lives on-chain in
// the pool goalSpec and is visible only on the token-gated challenge landing and
// the participant's own pages - it is NEVER copied into the challenges row and
// NEVER reaches the public feed. The row stores only the challenger's framing
// message and an optional target label.
//
// PRESENTATION: this is the ported v0 "golden" design — a two-column composer
// with a centered SPOTTER header, a candy type-picker, an amount picker whose
// SPOTTER mood ladders with the number, and a live, screenshot-styled preview
// card in the right column. The money logic below is untouched; only the layout,
// copy, and mascot moments are the golden port. Honest-core is preserved: money
// figures render through the mono Money primitive, the testnet sticker is tan
// (never gold - gold is money in motion only), and self-reported evidence never
// reads "verified".

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { parseUsdc, withDocMarker, withProofPolicy } from "@/lib/contract";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useDisplayNames } from "@/lib/use-display-names";
import { useUsdcDeposit } from "@/lib/useUsdcDeposit";
import GaslessBadge from "@/components/GaslessBadge";
import ShareChallenge from "@/components/ShareChallenge";
import SignInGate from "@/components/SignInGate";
import { resolveNewPoolId } from "@/lib/resolve-pool-id";
import {
  fetchChallengesHealth,
  runDareFlow,
  type FundedDare,
  type MintResult,
} from "@/lib/challenge-flow";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { authBlockReason, fetchWithWalletAuth } from "@/lib/client-auth";
import {
  challengeShareUrl,
  checkMessage,
  checkTargetHandle,
  normalizeTargetHandle,
  MESSAGE_MAX,
  TARGET_HANDLE_MAX,
} from "@/lib/challenges";
import { ArcTxLink, Button, Card, Chip, ErrorNote, Money, Skeleton } from "@/components/ui";
import { useApprovalProbe } from "@/components/game/ApprovalNote";
import {
  challengeCreateBlock,
  payoutStateOf,
  verifierStateOf,
} from "@/lib/game/join-checks";
import { useDocumentProofQuery } from "@/lib/useProofStatus";

const DURATION_OPTIONS: { label: string; days: number }[] = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "30 days", days: 30 },
];

// Quick-pick amounts for the headline number (a self-stake or a dare reward).
// Ported from the golden design: three warm chips plus Custom. The text input
// stays for any custom amount - the chips are shortcuts, not a cap.
const AMOUNT_CHIPS = [5, 10, 25] as const;
// The friend's lock-in to accept a dare: real money, deliberately small.
const DARE_LOCKIN_CHIPS = [3, 5, 10] as const;

// Goal / dare ideas, one tap to fill. Ported verbatim from the golden design.
const NAME_SUGGESTIONS = [
  "8k steps a day, 7 days straight",
  "no sugar for 2 weeks",
  "gym 4x this week, no excuses",
  "the thing you've been putting off",
];

// Trash-talk one-liners for the dare message. Ported from the golden design.
const TRASH_TALK_SUGGESTIONS = [
  "bet you can't. proving me wrong pays.",
  "put your steps where your mouth is.",
  "easy money for me. we'll see.",
  "i've seen you flake before. don't.",
];

const SECONDS_PER_DAY = 86_400;

// Longer copy lives as constants so the JSX stays clean and the apostrophes /
// quotes / dashes render exactly, without escaping.
const SPOTTER_INTRO =
  "I'm SPOTTER. I hold the money, I check your proof, I pay you the second you hit it. No vibes, no chasing anyone for cash. Let's set one up.";
const HONESTY_NOTE =
  'Play-money testnet USDC, not a real-money bet. A selfie proves it to your friends - only wearable or enclave data counts as "verified" here.';
const FOOTER_NOTE =
  "Testnet play-money USDC - a commitment device, not a bet. No house, no odds, just your money and your word.";

const CHALLENGE_INITIATIVE = "challenge";
// Both variants are commitment pools (bountyModel 2). See the compliance-lane
// note in the header: forfeited stakes only ever reach peer achievers, so the
// creator never profits from a participant missing, and the contract's H-1 rule
// (every pool carries an entry fee above zero) is satisfied because every player
// stakes on join.
const CHALLENGE_BOUNTY_MODEL = 2;

// A Next Link dressed as the shared candy Button. Button is a <button> and
// cannot be a Link, so the post-create navigation matches its look here rather
// than hand-rolling a one-off style: emerald pop for the go-do-it action, a
// tan-filled secondary for the quieter "start another".
const CANDY_LINK_PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 py-3 font-display text-sm font-bold text-white shadow-[var(--shadow-pop)] transition-transform hover:translate-y-px hover:bg-accent-strong active:translate-y-[3px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const CANDY_LINK_SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-full border-2 border-edge bg-secondary px-5 py-2.5 font-display text-sm font-bold text-secondary-foreground transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Which of the two honest variants the creator is building. */
type Variant = "self" | "dare";

type Phase =
  | { kind: "idle" }
  | { kind: "linking" }
  // A self-staked commitment pool is live; the creator now locks in their stake
  // by joining it on the pool page (createPool takes no stake - joinPool does).
  | { kind: "selfDone"; poolId: string }
  // A dare is funded and its person-aimed link is minted.
  | { kind: "dareDone"; url: string; poolId: string }
  // Nothing moved: a preflight refusal or a pre-deposit failure.
  | { kind: "error"; title: string; message: string }
  // The reward LANDED on chain but the link did not mint. The funded pool is
  // held in `funded` state so the only action left is a link-only retry.
  | { kind: "linkError"; message: string };

/** The invite framing captured at funding time, so a link-only retry sends
 *  what the challenger paid for even if the form is edited afterwards. */
interface DareInvite {
  message: string | null;
  targetHandle: string | null;
}

// ------------------------------------------------------------------ SPOTTER mood
// The amount picker's live reaction. Ported from the golden design's
// getSpotterMoodForAmount, but mapped to the REAL transparent poses in
// public/spotter/ (the golden filenames were invented). SPOTTER never states a
// number in its own speech - only the pose and the deadpan line react; the
// amount lives in the input and the Money slot.
type SpotterMood = { pose: string; alt: string; line: string };

function getSpotterMoodForAmount(
  amount: number,
  kind: Variant,
): SpotterMood {
  if (amount < 10) {
    return {
      pose: "peek",
      alt: "SPOTTER peeking out, unimpressed",
      line:
        kind === "self"
          ? "That's it? I've seen bigger commitment in a gas station burrito."
          : "That reward wouldn't get me off this rock. Just saying.",
    };
  }
  if (amount < 25) {
    return {
      pose: "standing",
      alt: "SPOTTER standing tall, nodding it over",
      line:
        kind === "self"
          ? "Respectable. Enough to sting if you flake, not enough to cry about."
          : "Solid dare energy. They'll feel this one.",
    };
  }
  if (amount < 50) {
    return {
      pose: "cheer",
      alt: "SPOTTER cheering you on",
      line:
        kind === "self"
          ? "Now we're talking. I love a person with something to lose."
          : "Okay big spender. They better not flake on this.",
    };
  }
  return {
    pose: "payday",
    alt: "SPOTTER holding a payday of coins",
    line:
      kind === "self"
        ? "I'm holding THAT much? Fine by me. I'm an excellent banker."
        : "That's a real dare. I'm getting the vault ready.",
  };
}

// ------------------------------------------------------------------------- icons
// Inline SVGs (lucide is not a dependency here). Decoration only: aria-hidden,
// currentColor, sized by the caller.
function Icon({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

const IconPaw = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="6.5" cy="9.5" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="10" cy="6.5" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="14" cy="6.5" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="9.5" r="1.6" fill="currentColor" stroke="none" />
    <path
      d="M12 12c2.5 0 4.5 1.8 4.5 4 0 1.7-1.5 2.5-3 2.5-.8 0-1-.4-1.5-.4s-.7.4-1.5.4c-1.5 0-3-.8-3-2.5 0-2.2 2-4 4.5-4Z"
      fill="currentColor"
      stroke="none"
    />
  </Icon>
);

const IconCoins = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <ellipse cx="9" cy="7" rx="6" ry="3" />
    <path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7" />
    <path d="M15 12.5c2.8-.3 6-1.5 6-3.5" />
    <path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-4" />
  </Icon>
);

const IconSwords = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M14.5 17.5 4 6V3h3l11.5 11.5" />
    <path d="m13 19 6-6" />
    <path d="m16 16 4 4" />
    <path d="m19 21 2-2" />
    <path d="M9.5 17.5 20 6V3h-3L5.5 14.5" />
    <path d="m5 19-2-2" />
    <path d="m8 16-4 4" />
    <path d="m3 21 2-2" />
  </Icon>
);

const IconShield = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

const IconSparkle = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M12 3.5 13.6 9l5.5 1.6L13.6 12 12 17.5 10.4 12 4.9 10.6 10.4 9 12 3.5Z" />
  </Icon>
);

const IconArrow = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Icon>
);

const IconLink = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M9 15 15 9" />
    <path d="M11 6.5 13 4.5a4 4 0 0 1 5.5 5.5l-2 2" />
    <path d="M13 17.5 11 19.5a4 4 0 0 1-5.5-5.5l2-2" />
  </Icon>
);

// ----------------------------------------------------------------- SPOTTER bubble
// The mood reaction: a framed SPOTTER pose plus an anchored speech bubble. Ported
// from the golden spotter-bubble, using the real transparent PNGs (object-contain
// so the cutout is never cropped) on a warm tan frame.
function SpotterBubble({ mood }: { mood: SpotterMood }) {
  return (
    <div className="flex items-end gap-3">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-secondary p-1 sm:h-20 sm:w-20">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/spotter/spotter-${mood.pose}.png`}
          alt={mood.alt}
          className="h-full w-full object-contain"
        />
      </div>
      <div className="relative flex-1 rounded-2xl rounded-bl-sm border border-edge bg-surface px-4 py-3 shadow-sm">
        <p className="text-sm leading-snug text-foreground sm:text-[15px]">
          {mood.line}
        </p>
        <span className="mt-1 block text-[11px] font-bold uppercase tracking-wide text-accent-strong">
          SPOTTER
        </span>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- amount chips
// A tactile chip row plus a Custom escape hatch. Values stay STRINGS so the
// existing parseUsdc path is untouched (it throws on a half-typed amount, which
// is why the number is only ever read loosely for the mood/preview).
function AmountChips({
  chips,
  value,
  onChange,
  ariaLabel,
}: {
  chips: readonly number[];
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const presets = chips.map(String);
  const [customOpen, setCustomOpen] = useState(
    value.trim() !== "" && !presets.includes(value.trim()),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <Chip
            key={chip}
            selected={!customOpen && value.trim() === String(chip)}
            onClick={() => {
              setCustomOpen(false);
              onChange(String(chip));
            }}
          >
            ${chip}
          </Chip>
        ))}
        <Chip
          selected={customOpen}
          onClick={() => {
            setCustomOpen(true);
            onChange("");
          }}
        >
          Custom
        </Chip>
      </div>
      {customOpen ? (
        <div className="flex items-center gap-2">
          <span className="font-display text-lg font-semibold text-muted">$</span>
          <input
            type="text"
            inputMode="decimal"
            aria-label={ariaLabel}
            placeholder="Your call"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="min-h-11 max-w-[160px] rounded-xl border-2 border-edge bg-surface-raised px-3 py-2 font-display text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <span className="text-sm text-muted">USDC</span>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------- suggestion chip row
function SuggestionRow({
  items,
  onPick,
  tone = "accent",
}: {
  items: string[];
  onPick: (value: string) => void;
  tone?: "accent" | "coral";
}) {
  const hover =
    tone === "coral"
      ? "hover:border-[color:var(--coral-strong)] hover:text-[color:var(--coral-strong)]"
      : "hover:border-accent/50 hover:text-accent-strong";
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onPick(item)}
          className={`min-h-11 rounded-full border border-edge bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground transition-colors ${hover}`}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- the type picker
// The one clear choice, as two candy tiles. Emerald pop for staking on yourself
// (the HERO MOVE, selected by default), coral pop for the human act of a dare.
function TypePicker({
  value,
  onChange,
}: {
  value: Variant;
  onChange: (v: Variant) => void;
}) {
  const isSelf = value === "self";
  return (
    <div
      role="radiogroup"
      aria-label="Challenge type"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      <button
        type="button"
        role="radio"
        aria-checked={isSelf}
        onClick={() => onChange("self")}
        className={`relative flex flex-col gap-2 rounded-3xl border-2 p-5 text-left transition-transform hover:translate-y-px active:translate-y-[3px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          isSelf
            ? "border-accent bg-accent/10 shadow-[var(--shadow-pop)]"
            : "border-edge bg-surface shadow-[var(--shadow-pop-edge)] hover:border-accent/40"
        }`}
      >
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            isSelf ? "bg-accent text-white" : "bg-secondary text-accent-strong"
          }`}
        >
          <IconCoins className="h-5 w-5" />
        </span>
        <span className="font-display text-lg font-bold">Stake on yourself</span>
        <span className="text-sm leading-snug text-muted">
          Your own USDC on your own goal. Hit it, get it back plus a cut of what
          everyone who flaked forfeited.
        </span>
        {isSelf ? (
          <span className="absolute right-3 top-3 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
            Hero move
          </span>
        ) : null}
      </button>

      <button
        type="button"
        role="radio"
        aria-checked={!isSelf}
        onClick={() => onChange("dare")}
        className={`relative flex flex-col gap-2 rounded-3xl border-2 p-5 text-left transition-transform hover:translate-y-px active:translate-y-[3px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          !isSelf
            ? "border-[color:var(--coral-strong)] bg-secondary shadow-[var(--shadow-pop-coral)]"
            : "border-edge bg-surface shadow-[var(--shadow-pop-edge)] hover:border-[color:var(--coral-strong)]/40"
        }`}
      >
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            !isSelf
              ? "bg-coral-strong text-white"
              : "bg-secondary text-[color:var(--coral-strong)]"
          }`}
        >
          <IconSwords className="h-5 w-5" />
        </span>
        <span className="font-display text-lg font-bold">Dare a friend</span>
        <span className="text-sm leading-snug text-muted">
          You put up the reward, they lock in a small stake. They hit it, they
          keep both. They flake, everyone gets their money back.
        </span>
      </button>
    </div>
  );
}

// ------------------------------------------------------------- the live preview card
// The emotional centerpiece: the screenshot-styled artifact the recipient will
// see, updating live as the form changes. Honest-core: the amount renders through
// the mono Money primitive (never a display-font dollar sign), the sticker is tan
// (never gold), and the note keeps "verified" in scare-quotes for self-reports.
function PreviewCard({
  variant,
  title,
  amount,
  lockIn,
  recipient,
  trashTalk,
}: {
  variant: Variant;
  title: string;
  amount: string;
  lockIn: string;
  recipient: string;
  trashTalk: string;
}) {
  const isSelf = variant === "self";
  const displayTitle =
    title.trim() !== "" ? title.trim() : "the thing you've been putting off";
  const displayAmount = amount.trim() !== "" ? amount.trim() : "0";
  const displayLockIn = lockIn.trim() !== "" ? lockIn.trim() : "0";
  const cleanRecipient = recipient.trim().replace(/^@/, "");
  const displayTrash =
    trashTalk.trim() !== ""
      ? trashTalk.trim()
      : "bet you can't. proving me wrong pays.";

  return (
    <div className="relative overflow-visible">
      {/* Tan testnet sticker, deliberately NOT gold (gold is money in motion
          only). The tilt gives it the "made this to post" feel. */}
      <div className="absolute -left-2 -top-3 z-10 -rotate-6 rounded-full border-2 border-edge bg-secondary px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-secondary-foreground shadow-sm">
        Testnet USDC
      </div>

      <div className="relative rounded-3xl border-2 border-edge bg-surface p-6 shadow-[var(--shadow-pop-edge)]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1">
            {isSelf ? (
              <IconCoins className="h-3.5 w-3.5 text-accent-strong" />
            ) : (
              <IconSwords className="h-3.5 w-3.5 text-[color:var(--coral-strong)]" />
            )}
            <span className="text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
              {isSelf ? "Self-stake" : "Friend dare"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-accent/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/spotter/spotter-watching.png"
                alt=""
                aria-hidden="true"
                className="h-full w-full object-contain"
              />
            </span>
            <span className="text-xs font-medium text-muted">held by SPOTTER</span>
          </div>
        </div>

        <h3 className="mt-4 font-display text-2xl font-bold leading-tight text-balance sm:text-[26px]">
          {displayTitle}
        </h3>

        <p className="mt-3 text-sm leading-snug text-muted">
          {isSelf ? (
            <>
              <span className="font-semibold text-foreground">You</span> vs.
              yourself. Hit it, get your stake back plus a cut of the flakers&apos;
              pot.
            </>
          ) : (
            <>
              For{" "}
              <span className="font-semibold text-foreground">
                {cleanRecipient !== ""
                  ? `@${cleanRecipient}`
                  : "whoever opens the link"}
              </span>
              . Hit it, keep the stake and the reward. Flake, and their stake
              goes back to them and you take the reward back from the run page
              once it settles.
            </>
          )}
        </p>

        <div className="mt-4 flex items-end justify-between gap-3 rounded-2xl bg-secondary/70 px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {isSelf ? "On the line" : "Reward if they hit it"}
            </p>
            <div className="mt-0.5">
              <Money usd={displayAmount} size="xl" />
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {isSelf ? "If you flake" : "Their lock-in"}
            </p>
            {isSelf ? (
              <p className="font-display text-lg font-bold text-[color:var(--coral-strong)]">
                you forfeit it
              </p>
            ) : (
              <div className="mt-0.5">
                <Money usd={displayLockIn} size="md" />
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-dashed border-edge bg-background/60 px-4 py-3">
          <p className="text-sm italic leading-snug text-foreground">
            &ldquo;{displayTrash}&rdquo;
          </p>
        </div>

        <div className="mt-4 flex items-start gap-1.5 text-[11px] leading-snug text-muted">
          <IconShield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{HONESTY_NOTE}</span>
        </div>
      </div>
    </div>
  );
}

/** Tap-to-copy for the finished challenge link. A share link is not a wallet
 *  address, so it wears its own control rather than borrowing CopyAddressButton's
 *  address-specific labels. Mirrors CopyAddressButton's failure handling: some
 *  mobile in-app browsers and non-secure contexts expose no clipboard API, so a
 *  silent no-op would strand the challenger with an unshareable link. On failure
 *  it says so and points at the full link, which is shown here to select by hand. */
function CopyLink({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = () => {
    const clipboard =
      typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard === undefined) {
      setState("failed");
      return;
    }
    clipboard.writeText(url).then(
      () => {
        setState("copied");
        setTimeout(() => setState("idle"), 2500);
      },
      () => setState("failed"),
    );
  };
  return (
    <>
      <button
        type="button"
        onClick={copy}
        title="Tap to copy the challenge link"
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-edge bg-surface-raised px-3 py-3 text-left font-mono text-xs text-foreground/80 hover:border-accent/50 hover:text-foreground"
      >
        <span className="break-all">{url}</span>
        <span
          aria-live="polite"
          className="shrink-0 font-sans text-xs font-semibold uppercase tracking-wide text-accent"
        >
          {state === "copied"
            ? "Copied"
            : state === "failed"
              ? "Copy failed"
              : "Tap to copy"}
        </span>
      </button>
      {state === "failed" ? (
        <p aria-live="polite" className="text-xs text-muted">
          Copying is blocked in this browser - select the link above by hand.
        </p>
      ) : null}
    </>
  );
}

// A framed SPOTTER cheer for the done screens. Reuses the mood-bubble language.
function DoneSpotter({ pose, alt, line }: SpotterMood) {
  return <SpotterBubble mood={{ pose, alt, line }} />;
}

function CreateChallengeInner() {
  const { ready, authenticated, address } = useEmbeddedWallet();
  const requestAuth = useWalletAuth();
  const { status, busy, reset, runUsdcDeposit, gasless } = useUsdcDeposit();
  // The challenger's own name, for the "from @you" line on the done screen.
  const { displayName } = useDisplayNames(address !== null ? [address] : []);

  // Default to the HERO MOVE (stake on yourself), matching the golden design.
  // The ?v= preselect below still overrides it for a "Dare a friend" entry.
  const [variant, setVariant] = useState<Variant>("self");
  const [goal, setGoal] = useState("");
  // The stake every player puts up on their OWN goal, pulled on join. For SELF
  // this is the creator's own stake (the headline amount); for DARE it is the
  // friend's lock-in. Pre-filled so the preview and SPOTTER's mood have a number
  // to react to from the first paint.
  const [stake, setStake] = useState("10");
  // DARE only: the reward the challenger seeds at creation (the headline amount).
  const [reward, setReward] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState("");
  // Off by default: a challenge stays a document-floor pool (byte-identical to
  // today) unless the creator explicitly opts into accepting a self-reported
  // photo, which loosens the floor to also allow the low-trust tier.
  const [acceptSelf, setAcceptSelf] = useState(false);
  const [durationDays, setDurationDays] = useState(30);
  // Golden "who's it for" toggle. In "link" mode the target is left blank and the
  // dare is shared by link alone - which is exactly the on-chain behaviour of a
  // blank target, so the toggle stays honest.
  const [recipientMode, setRecipientMode] = useState<"handle" | "link">("handle");
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // A dare whose reward has landed. While set, the main button only retries
  // the link; it can never deposit into a second pool.
  const [funded, setFunded] = useState<FundedDare | null>(null);
  const [fundedInvite, setFundedInvite] = useState<DareInvite | null>(null);

  const isDare = variant === "dare";

  // Can this build mint a dare link at all? Asked up front so an unready build
  // says so before the challenger fills anything in; runDareFlow asks again
  // right before the deposit, which is the check that actually gates money.
  const healthQuery = useQuery({
    queryKey: ["challenges-health"],
    queryFn: () => fetchChallengesHealth(),
    enabled: isDare,
    staleTime: 30_000,
    retry: 1,
  });
  const daresOff =
    isDare && healthQuery.data !== undefined && !healthQuery.data.ok
      ? healthQuery.data.message
      : null;
  const checkingDares = isDare && healthQuery.isLoading;
  // Every dare is an upload-proof run (encodeGoal below), so it can only be
  // made while SPOTTER's document checker is on and a win can pay. Decided
  // before the form and again on submit, never after the deposit.
  const proofQuery = useDocumentProofQuery();
  const approvalProbe = useApprovalProbe();
  const createBlock = challengeCreateBlock(
    verifierStateOf(proofQuery),
    payoutStateOf(approvalProbe.mode),
  );

  // Switch variants and keep a sensible headline number so the preview never
  // reads $0 the instant you toggle. Seeds a dare reward and a dare lock-in the
  // first time you land on it; leaves anything you already typed alone.
  const selectVariant = (next: Variant) => {
    setFormError(null);
    setVariant(next);
    if (next === "dare") {
      if (reward.trim() === "") setReward("10");
      if (stake.trim() === "") setStake("5");
    } else if (next === "self" && stake.trim() === "") {
      setStake("10");
    }
  };

  // Preselect the variant from ?v=self|dare so the challenges landing can send a
  // "Dare a friend" tap straight to that mode. Read in an effect (not the initial
  // state) so the first client render matches the server and never mismatches on
  // hydration; the default stays "self".
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = new URLSearchParams(window.location.search).get("v");
    // Reading the URL once on mount is the external-system case the rule
    // exempts; the first render must match the server, so it cannot move
    // into a state initializer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (v === "self" || v === "dare") selectVariant(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The headline amount is a self-stake (self) or the reward you fund (dare).
  const headlineAmount = isDare ? reward : stake;
  const setHeadlineAmount = isDare ? setReward : setStake;
  // A lightweight numeric read for the mood/preview only (never parseUsdc, which
  // throws on a half-typed amount), so a bad keystroke just leaves SPOTTER at
  // rest rather than erroring.
  const headlineAmountNum = Number(headlineAmount.trim()) || 0;
  const mood = getSpotterMoodForAmount(headlineAmountNum, variant);

  const clearForm = () => {
    reset();
    setPhase({ kind: "idle" });
    setFunded(null);
    setFundedInvite(null);
    setGoal("");
    setStake("10");
    setReward("");
    setMessage("");
    setTarget("");
    setAcceptSelf(false);
    setDurationDays(30);
    setRecipientMode("handle");
  };

  const submit = async () => {
    // A funded dare only ever retries its link. This is the guard that keeps a
    // second tap from creating and funding a second pool.
    if (isDare && funded !== null && fundedInvite !== null) {
      await finishDare(funded, fundedInvite);
      return;
    }
    setFormError(null);
    setPhase({ kind: "idle" });
    if (createBlock.kind !== "ok") {
      setFormError(
        createBlock.kind === "paused"
          ? createBlock.detail
          : "I am still checking whether dares can run right now. Try again in a moment.",
      );
      return;
    }

    let stakeUsdc: bigint;
    let rewardUsdc: bigint;
    try {
      if (goal.trim() === "") {
        throw new Error(
          isDare
            ? "Say what they have to do, for example \"lose 10 lbs\"."
            : "Say what you are going to do, for example \"sleep 8h a night\".",
        );
      }
      // The contract requires every player to be a staker (a zero entry fee
      // reverts DEAD_CONFIG), and a commitment pool with a zero stake makes no
      // pool. The stake is real money on the line for whoever hits the goal.
      stakeUsdc = parseUsdc(stake.trim() === "" ? "0" : stake.trim());
      if (stakeUsdc <= 0n) {
        throw new Error(
          isDare
            ? "Set their lock-in above zero. It is what puts skin in the game - and they get it back when they hit the goal."
            : "Put up a stake above zero. This is your own money on the line.",
        );
      }
      // DARE seeds the reward at creation; SELF pulls no USDC at creation (the
      // creator's stake is pulled when they join to lock in).
      if (isDare) {
        rewardUsdc = parseUsdc(reward.trim() === "" ? "0" : reward.trim());
        if (rewardUsdc <= 0n) {
          throw new Error(
            "Put up a reward above zero. This is the money you are backing them with.",
          );
        }
      } else {
        rewardUsdc = 0n;
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Check the form values.");
      return;
    }

    if (isDare) {
      const messageCheck = checkMessage(message);
      if (!messageCheck.ok) {
        setFormError(messageCheck.reason);
        return;
      }
      // Canonicalize the recipient to a real @handle (strip @, lowercase) so it
      // matches what they claimed and surfaces under "Invited to you". Blank
      // stays blank and the flow is unchanged - the link is still shareable to
      // anyone.
      const targetCheck = checkTargetHandle(normalizeTargetHandle(target));
      if (!targetCheck.ok) {
        setFormError(targetCheck.reason);
        return;
      }
      await submitDare(stakeUsdc, rewardUsdc, {
        message: messageCheck.message,
        targetHandle: targetCheck.targetHandle,
      });
      return;
    }

    await submitSelf(stakeUsdc);
  };

  // Shared with both variants: encode the goal's proof policy the same way. A
  // document floor stays byte-identical to before; opting into self-reported
  // loosens the floor to also accept a photo, which is the low-trust tier and
  // never marked verified.
  const encodeGoal = (): string =>
    acceptSelf
      ? withProofPolicy(goal.trim(), {
          floor: "document",
          accepted: ["document", "self-reported"],
        })
      : withDocMarker(goal.trim());

  const periodBounds = (): { periodStart: bigint; periodEnd: bigint } => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    return {
      periodStart: now,
      periodEnd: now + BigInt(durationDays * SECONDS_PER_DAY),
    };
  };

  // STAKE ON YOURSELF: create the commitment pool (no USDC pulled at creation),
  // then hand the creator to the pool page to lock in their own stake by
  // joining. Inviting friends to stake alongside happens from the pool page too.
  const submitSelf = async (stakeUsdc: bigint) => {
    const { periodStart, periodEnd } = periodBounds();
    // Only a landed createPool can leave a pool behind. A throw before it is
    // already on status (the hook's ErrorNote); a throw after it is the pool
    // lookup, and the pool exists, so point at where it is listed.
    let created = false;
    try {
      const depositHash = await runUsdcDeposit(0n, {
        functionName: "createPool",
        args: [
          CHALLENGE_INITIATIVE,
          encodeGoal(),
          stakeUsdc,
          periodStart,
          periodEnd,
          CHALLENGE_BOUNTY_MODEL,
          0n,
        ],
      });
      created = true;
      const poolId = await resolveNewPoolId(depositHash);
      setPhase({ kind: "selfDone", poolId: poolId.toString() });
    } catch {
      if (created) {
        setPhase({
          kind: "error",
          title: "Your commitment was created",
          message:
            "Nothing left your wallet, but we could not open it yet. Find it under My challenges and stake from there.",
        });
      }
    }
  };

  // Mint the person-aimed link for a pool that already exists. Signed, and
  // never throws on a refusal: every failure comes back as a message for the
  // retry note.
  const mintLink = async (
    poolId: bigint,
    invite: DareInvite,
  ): Promise<MintResult> => {
    if (address === null) {
      return {
        ok: false,
        message: "Your wallet disconnected before the link could be signed.",
      };
    }
    const sent = await fetchWithWalletAuth(
      "/api/challenges",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address,
          poolId: poolId.toString(),
          targetHandle: invite.targetHandle,
          message: invite.message,
        }),
      },
      requestAuth,
    );
    if (!sent.response.ok) {
      if (sent.auth.kind !== "ok") {
        return {
          ok: false,
          message:
            authBlockReason(sent.auth) ??
            "Sign with your wallet to send this challenge.",
        };
      }
      const body = (await sent.response.json().catch(() => ({}))) as {
        error?: string;
      };
      return {
        ok: false,
        message: body.error ?? "Could not create the challenge link.",
      };
    }
    const body = (await sent.response.json().catch(() => ({}))) as {
      challenge?: { inviteToken?: string };
    };
    const token = body.challenge?.inviteToken;
    return typeof token === "string" && token !== ""
      ? { ok: true, token }
      : { ok: false, message: "The link came back empty." };
  };

  // Drive the dare from wherever it stands: a fresh dare (preflight, deposit,
  // link) when `from` is null, a link-only retry when it is a funded pool.
  const driveDare = async (
    from: FundedDare | null,
    invite: DareInvite,
    deposit: () => Promise<`0x${string}`>,
  ) => {
    const result = await runDareFlow(
      {
        checkHealth: () => fetchChallengesHealth(),
        deposit,
        resolvePoolId: (hash) => resolveNewPoolId(hash),
        mintLink: (poolId) => mintLink(poolId, invite),
        onFunded: (next) => {
          setFunded(next);
          setFundedInvite(invite);
        },
        onLinking: () => setPhase({ kind: "linking" }),
      },
      from,
    );
    switch (result.kind) {
      case "unavailable":
        setPhase({
          kind: "error",
          title: "Dares are not live here yet",
          message: result.message,
        });
        return;
      case "depositFailed":
        // Nothing moved. The hook's status note already says why; the phase
        // stays idle so no "reward is up" copy can render.
        setPhase({ kind: "idle" });
        return;
      case "linkFailed":
        setPhase({ kind: "linkError", message: result.message });
        return;
      case "done": {
        const origin =
          typeof window === "undefined" ? "" : window.location.origin;
        setFunded(null);
        setFundedInvite(null);
        setPhase({
          kind: "dareDone",
          url: challengeShareUrl(origin, result.token),
          poolId: result.poolId.toString(),
        });
      }
    }
  };

  // Link-only retry for a dare whose reward already landed.
  const finishDare = (from: FundedDare, invite: DareInvite) =>
    driveDare(from, invite, () => {
      // Unreachable by construction (runDareFlow skips the deposit when `from`
      // is set); failing loudly beats ever funding a second pool.
      throw new Error("A funded dare never deposits again.");
    });

  // DARE A FRIEND: preflight, seed the reward at creation, then mint the link.
  const submitDare = async (
    stakeUsdc: bigint,
    rewardUsdc: bigint,
    invite: DareInvite,
  ) => {
    const { periodStart, periodEnd } = periodBounds();
    await driveDare(null, invite, () =>
      runUsdcDeposit(rewardUsdc, {
        functionName: "createPool",
        args: [
          CHALLENGE_INITIATIVE,
          encodeGoal(),
          stakeUsdc,
          periodStart,
          periodEnd,
          CHALLENGE_BOUNTY_MODEL,
          rewardUsdc,
        ],
      }),
    );
  };

  if (phase.kind === "selfDone") {
    return (
      <div className="mx-auto max-w-xl space-y-5">
        <Card pop className="space-y-2 border-accent/40">
          <p className="font-display text-lg font-bold text-accent-strong">
            Your commitment is live. One tap to lock it in.
          </p>
          <p className="text-sm text-foreground/80">
            Nothing left your wallet yet - you stake by joining your own pool.
            Put up your <Money usd={stake.trim() === "" ? "0" : stake.trim()} />{" "}
            and you are in: hit the goal and it comes back with a cut of what
            everyone who flaked forfeited.
          </p>
        </Card>

        <DoneSpotter
          pose="cheer"
          alt="SPOTTER cheering that your commitment is live"
          line="Locked and loaded. Go stake in and I'll hold it - no funny business."
        />

        <div className="flex flex-wrap gap-3">
          <Link href={`/pools/${phase.poolId}`} className={CANDY_LINK_PRIMARY}>
            Stake to lock in and invite friends
          </Link>
          <button
            type="button"
            onClick={clearForm}
            className={CANDY_LINK_SECONDARY}
          >
            Start another
          </button>
        </div>
        <p className="text-xs text-muted">
          On the pool page you lock in your stake and can share the pool so
          friends stake alongside you - everyone on their own goal.
        </p>
      </div>
    );
  }

  if (phase.kind === "dareDone") {
    return (
      <div className="mx-auto max-w-xl space-y-5">
        <Card pop className="space-y-2 border-accent/40">
          <p className="font-display text-lg font-bold text-accent-strong">
            Dare sent. The reward is on the line.
          </p>
          {address !== null ? (
            <p className="text-xs font-medium text-foreground/70">
              From {displayName(address)}
            </p>
          ) : null}
          <p className="text-sm text-foreground/80">
            Send this link to the one person it is for. Whoever opens it can
            accept, stake their lock-in, and go for the goal - hit it and they
            collect their lock-in back plus your reward, the moment it is
            verified.
          </p>
        </Card>

        <DoneSpotter
          pose="payday"
          alt="SPOTTER guarding the reward you just put up"
          line="Reward's in the vault. Send them the link - I'll pay the second they prove it."
        />

        <div className="space-y-3">
          <p className="font-display text-xs font-bold uppercase tracking-wide text-muted">
            Send it to them
          </p>
          {/* Web Share / Text / Email, prefilled with the dare, reward and
              link. CopyLink stays below as the desktop fallback. */}
          <ShareChallenge
            url={phase.url}
            title="You've been challenged on GoHealthMe"
            message={`I'm daring you: ${goal.trim()}. Hit it and I pay you ${reward.trim()} USDC.`}
            emailSubject="I'm daring you - GoHealthMe"
            includeCopy={false}
            shareLabel="Share the dare"
          />
          <CopyLink url={phase.url} />
          <p className="text-xs text-muted">
            Anyone with this link can see the dare and accept it, so send it
            straight to them. It is not listed anywhere and cannot be guessed.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link href={`/pools/${phase.poolId}`} className={CANDY_LINK_SECONDARY}>
            View the pool
          </Link>
          <button
            type="button"
            onClick={clearForm}
            className={CANDY_LINK_SECONDARY}
          >
            Send another
          </button>
        </div>
      </div>
    );
  }

  // A dare mid-creation (deposit or link step in flight) keeps its form: the
  // block only stops a new one from starting.
  const inFlight = busy || phase.kind === "linking" || phase.kind === "error";
  if (!inFlight && createBlock.kind === "checking") {
    return (
      <div className="mx-auto max-w-xl space-y-4" aria-busy="true">
        <p className="sr-only" aria-live="polite">
          Checking whether dares can run
        </p>
        <Skeleton className="h-14 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!inFlight && createBlock.kind === "retry") {
    return (
      <div className="mx-auto max-w-xl">
        <ErrorNote
          title={createBlock.title}
          detail="It did not answer, so I am not starting a dare on a guess. Nothing has been charged."
          onRetry={() => {
            proofQuery.refetch();
            approvalProbe.refetch();
          }}
        />
      </div>
    );
  }
  if (!inFlight && createBlock.kind === "paused") {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Card className="space-y-2 border-warning/40">
          <p className="font-display text-2xl font-extrabold">{createBlock.title}</p>
          <p className="text-sm text-foreground/80">{createBlock.detail}</p>
        </Card>
        <Link href="/pools" className={CANDY_LINK_PRIMARY}>
          See the open runs
        </Link>
      </div>
    );
  }

  const linking = phase.kind === "linking";
  // The reward already landed: the button now only mints the link.
  const retryingLink = isDare && funded !== null;
  // Dares are refused before any money moves when the link store is not ready.
  const dareBlocked =
    isDare && !retryingLink && (daresOff !== null || checkingDares);
  const fundedPoolId =
    funded !== null && funded.poolId !== null ? funded.poolId.toString() : null;
  const primaryLabel =
    status.kind === "fueling"
      ? "One moment..."
      : status.kind === "approving"
      ? "Approving USDC..."
      : status.kind === "depositing"
        ? isDare
          ? "Putting up the reward..."
          : "Creating your commitment..."
        : linking
          ? "Minting the link..."
          : !authenticated
            ? "Sign in to start"
            : retryingLink
              ? "Retry the link"
              : isDare
                ? checkingDares
                  ? "Checking dares are live..."
                  : "Send the dare"
                : "Stake on it";

  return (
    <div className="mx-auto max-w-5xl">
      {/* Centered header: the play-money pill, the SPOTTER hero, the two-tone
          headline, and SPOTTER's intro line. */}
      <header className="mb-10 flex flex-col items-center text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-edge bg-surface px-3 py-1.5 shadow-sm">
          <IconPaw className="h-3.5 w-3.5 text-accent-strong" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            GoHealthMe · testnet play money
          </span>
        </div>

        <div className="otter-float mb-2 h-28 w-28 sm:h-32 sm:w-32">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/spotter/spotter-lounging.png"
            alt="SPOTTER, GoHealthMe's otter, floating on its back holding a coin"
            className="h-full w-full object-contain drop-shadow-md"
          />
        </div>

        <h1 className="font-display text-4xl font-extrabold leading-[1.05] text-balance sm:text-5xl">
          Send a challenge.
          <br />
          <span className="text-accent">Put money where your mouth is.</span>
        </h1>
        <p className="mt-3 max-w-md text-pretty text-base leading-relaxed text-muted">
          {SPOTTER_INTRO}
        </p>
      </header>

      {/* Two-column composer: the form on the left, the live preview on the
          right. Stacks on mobile with the preview card still prominent. */}
      <div className="grid gap-8 lg:grid-cols-[1fr_400px] lg:items-start lg:gap-10">
        {/* form column */}
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="font-display text-xl font-bold">Pick your poison</h2>
            <TypePicker value={variant} onChange={selectVariant} />
          </section>

          <section className="space-y-3">
            <label
              htmlFor="dare-title"
              className="font-display text-base font-semibold"
            >
              {isDare ? "Name the dare" : "Name your goal"}
            </label>
            <textarea
              id="dare-title"
              placeholder={
                isDare
                  ? "lose 10 lbs this month"
                  : "sleep 8h a night for 2 weeks"
              }
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              className="min-h-11 w-full rounded-xl border-2 border-edge bg-surface-raised px-3 py-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <SuggestionRow items={NAME_SUGGESTIONS} onPick={setGoal} />
            <p className="text-xs text-muted">
              {isDare
                ? "What they have to do. Proven by an uploaded record - the reward pays the moment it is verified in a confidential enclave."
                : "What you are going to do. Proven by an uploaded record - verified in a confidential enclave, so nobody ever sees your health data."}
            </p>
          </section>

          <section className="space-y-3">
            <label className="font-display text-base font-semibold">
              {isDare
                ? "The reward you're putting up"
                : "Stake it. How much do you actually mean this?"}
            </label>
            <AmountChips
              chips={AMOUNT_CHIPS}
              value={headlineAmount}
              onChange={setHeadlineAmount}
              ariaLabel={
                isDare
                  ? "The reward you put up in USDC"
                  : "Your stake in USDC"
              }
            />
            <SpotterBubble mood={mood} />
            <p className="text-xs text-muted">
              {isDare
                ? "Pulled from your wallet now and held in the pool. If the pool ends with no winner, you reclaim it."
                : "Pulled from your wallet when you lock in. Hit the goal and it comes back with a cut of the forfeits; miss and it goes to whoever did."}
            </p>
          </section>

          {isDare ? (
            <>
              <section className="space-y-3">
                <label className="font-display text-base font-semibold">
                  Their lock-in to accept
                </label>
                <AmountChips
                  chips={DARE_LOCKIN_CHIPS}
                  value={stake}
                  onChange={setStake}
                  ariaLabel="Their lock-in in USDC"
                />
                <p className="text-xs text-muted">
                  The small amount they put up to lock in - real money keeps the
                  goal honest. They get it back when they hit it, and you never
                  pocket it.
                </p>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-display text-base font-semibold">
                    Who&apos;s it for
                  </span>
                  <div className="flex rounded-full border border-edge bg-secondary p-0.5">
                    <button
                      type="button"
                      onClick={() => setRecipientMode("handle")}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        recipientMode === "handle"
                          ? "bg-surface text-foreground shadow-sm"
                          : "text-muted"
                      }`}
                    >
                      @handle
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRecipientMode("link");
                        setTarget("");
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        recipientMode === "link"
                          ? "bg-surface text-foreground shadow-sm"
                          : "text-muted"
                      }`}
                    >
                      Link
                    </button>
                  </div>
                </div>
                {recipientMode === "handle" ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="font-display text-lg font-semibold text-muted">
                        @
                      </span>
                      <input
                        type="text"
                        aria-label="Their handle"
                        placeholder="theirhandle"
                        value={target}
                        maxLength={TARGET_HANDLE_MAX}
                        onChange={(e) => setTarget(e.target.value)}
                        className="min-h-11 w-full rounded-xl border-2 border-edge bg-surface-raised px-3 py-2.5 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      />
                    </div>
                    <p className="text-xs text-muted">
                      They see this under Invited to you in the app. Never made
                      public.
                    </p>
                  </>
                ) : (
                  <div className="flex items-center gap-2 rounded-xl border-2 border-dashed border-edge bg-secondary/50 px-4 py-3">
                    <IconLink className="h-4 w-4 shrink-0 text-muted" />
                    <span className="truncate text-sm text-muted">
                      A private link is minted when you hit send.
                    </span>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <label
                  htmlFor="trash-talk"
                  className="font-display text-base font-semibold"
                >
                  Trash talk (optional, but come on)
                </label>
                <textarea
                  id="trash-talk"
                  placeholder="bet you can't. proving me wrong pays."
                  value={message}
                  maxLength={MESSAGE_MAX}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={2}
                  className="min-h-11 w-full rounded-xl border-2 border-edge bg-surface-raised px-3 py-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <SuggestionRow
                  items={TRASH_TALK_SUGGESTIONS}
                  onPick={setMessage}
                  tone="coral"
                />
                <p className="text-xs text-muted">
                  Shown on the challenge link only.
                </p>
              </section>
            </>
          ) : null}

          <section className="space-y-3">
            <label className="font-display text-base font-semibold">
              {isDare ? "How long they have" : "How long you have"}
            </label>
            <div className="flex flex-wrap gap-2">
              {DURATION_OPTIONS.map((opt) => (
                <Chip
                  key={opt.days}
                  selected={durationDays === opt.days}
                  onClick={() => setDurationDays(opt.days)}
                >
                  {opt.label}
                </Chip>
              ))}
            </div>
            <p className="text-xs text-muted">
              {isDare
                ? "Starts the moment you send it."
                : "Starts the moment you lock in your stake."}
            </p>
          </section>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-edge bg-surface-raised p-3">
            <input
              type="checkbox"
              checked={acceptSelf}
              onChange={(e) => setAcceptSelf(e.target.checked)}
              className="mt-1"
            />
            <span className="text-xs font-normal text-muted">
              Also accept a self-reported photo (low-trust). We cannot confirm a
              photo is real, recent, or {isDare ? "theirs" : "yours"}, so it is
              never marked verified and pays at 1x. Leave off to require a real
              record.
            </span>
          </label>
        </div>

        {/* preview + submit column */}
        <div className="space-y-4 lg:sticky lg:top-6">
          <div className="flex items-center gap-1.5 px-1">
            <IconSparkle className="h-3.5 w-3.5 text-accent-strong" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              What they&apos;ll see
            </span>
          </div>

          <PreviewCard
            variant={variant}
            title={goal}
            amount={headlineAmount}
            lockIn={stake}
            recipient={target}
            trashTalk={message}
          />

          <SignInGate
            note={
              isDare
                ? "Sign in to send this challenge."
                : "Sign in to start your commitment."
            }
          >
            {(openSignIn) => (
              <Button
                type="button"
                variant={isDare ? "coral" : "primary"}
                pop
                disabled={!ready || busy || linking || dareBlocked}
                onClick={() => {
                  if (!authenticated) {
                    openSignIn();
                    return;
                  }
                  void submit();
                }}
                className="h-14 w-full text-lg"
              >
                {primaryLabel}
                {status.kind === "idle" &&
                !linking &&
                !dareBlocked &&
                authenticated &&
                !busy ? (
                  <IconArrow className="h-5 w-5" />
                ) : null}
              </Button>
            )}
          </SignInGate>

          {status.kind === "approving" || status.kind === "depositing" ? (
            <div className="rounded-xl border border-edge bg-surface-raised p-4 text-sm">
              <p className="font-medium">
                {isDare ? (
                  <>
                    Step {status.kind === "approving" ? "1" : "2"} of 2:{" "}
                    {status.kind === "approving"
                      ? "approving USDC for the reward"
                      : "putting the reward into the pool on Base"}
                  </>
                ) : (
                  "Creating your commitment pool on Base"
                )}
              </p>
            </div>
          ) : null}

          {authenticated ? <GaslessBadge status={gasless} /> : null}

          {linking ? (
            <div className="rounded-xl border border-edge bg-surface-raised p-4 text-sm">
              <p className="font-medium">
                Reward is in. Signing to mint your challenge link...
              </p>
            </div>
          ) : null}

          {daresOff !== null && !retryingLink ? (
            <div
              role="status"
              className="space-y-2 rounded-xl border border-edge bg-surface-raised p-4 text-sm"
            >
              <p className="font-semibold">Dares are not live here yet</p>
              <p className="text-foreground/80">{daresOff}</p>
              <button
                type="button"
                onClick={() => selectVariant("self")}
                className="font-semibold text-accent-strong underline underline-offset-2"
              >
                Stake on yourself instead
              </button>
            </div>
          ) : null}

          {isDare && status.kind === "done" ? (
            <div className="space-y-1 rounded-xl border border-accent/40 bg-accent/20 p-4">
              <p className="text-sm font-semibold text-accent-deep">
                Reward of <Money usd={reward.trim() === "" ? "0" : reward.trim()} />{" "}
                is in the pool.
              </p>
              <ArcTxLink txHash={status.depositHash} label="View the funding tx" />
            </div>
          ) : null}

          {formError !== null ? (
            <ErrorNote
              title="Check the challenge"
              detail={formError}
              onRetry={() => setFormError(null)}
            />
          ) : null}

          {status.kind === "error" && !retryingLink ? (
            <ErrorNote
              title={
                isDare
                  ? "Could not put up the reward"
                  : "Could not create your commitment"
              }
              detail={status.message}
              onRetry={reset}
            />
          ) : null}

          {phase.kind === "error" ? (
            <ErrorNote
              title={phase.title}
              detail={phase.message}
              onRetry={() => setPhase({ kind: "idle" })}
            />
          ) : null}

          {phase.kind === "linkError" ? (
            <div
              role="alert"
              className="space-y-2 rounded-xl border border-danger/40 bg-danger/10 p-4"
            >
              <p className="text-base font-semibold text-danger">
                The reward is up, but the link did not send
              </p>
              <p className="text-sm text-foreground/80">{phase.message}</p>
              <p className="text-sm text-foreground/80">
                Your reward is safe in the pool. Tap Retry the link - it only
                mints the link and will not charge you again.
              </p>
              {fundedPoolId !== null ? (
                <Link
                  href={`/pools/${fundedPoolId}`}
                  className="inline-block text-sm font-semibold text-accent-strong underline underline-offset-2"
                >
                  See your pool
                </Link>
              ) : null}
            </div>
          ) : null}

          <p className="px-1 text-center text-[11px] leading-snug text-muted">
            {FOOTER_NOTE}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function CreateChallenge() {
  if (!DYNAMIC_CONFIGURED) {
    return (
      <ErrorNote
        title="Sign-in is off on this build"
        detail="This part is not switched on for this build yet. Nothing is wrong on your side."
      />
    );
  }
  return <CreateChallengeInner />;
}
