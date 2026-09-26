"use client";

// Create a challenge. Two honest variants, one screen, one clear choice:
//
//   STAKE ON YOURSELF (commitment) — you put your OWN USDC on your OWN goal.
//     Hit it, your stake comes back plus a share of the pot. With only you
//     staked a miss has nobody to go to, so it comes back; once a friend
//     matches you, on a run SPOTTER can record a miss on (lib/miss-rule.ts),
//     whoever misses pays whoever hits. The copy is the flow's own
//     (lib/game/money-flow.ts, docs/MONEY-FLOWS.md F2), said before the stake.
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
// PRESENTATION (docs/DESIGN.md, Night Shift): a two-column composer. The form
// is one card with SPOTTER standing on its edge; the right column is the live
// preview, drawn as the run card the other side will see, and the one action.
// SPOTTER's amount reaction is a line in his caption box, never a second pose.
// The money logic below is untouched. Money is gold, test money is small print,
// and self-reported evidence never reads "verified".

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { parseUsdc } from "@/lib/contract";
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
import {
  ArcTxLink,
  Button,
  Card,
  Chip,
  ErrorNote,
  FOCUS_RING,
  Fine,
  RunCard,
  Skeleton,
  Stat,
  StatRow,
  buttonClasses,
} from "@/components/ui";
import SpotterCaption from "@/components/spotter/SpotterCaption";
import {
  CARD_TITLE,
  EmptyCard,
  FIELD,
  FIELD_HINT,
  Notice,
  OptionMark,
  PAGE_COLUMN,
  PerchedHeader,
  QUIET_ACTION,
  optionCard,
} from "@/components/night/kit";
import { runMoneyOf, type MoneyCopy, type RunMoney } from "@/lib/game/money-flow";
import { MoneyChips, MoneyTermsList } from "@/components/game/MoneyTerms";
import { missRuleWouldApply } from "@/lib/miss-rule";
import { useApprovalProbe } from "@/components/game/ApprovalNote";
import {
  challengeCreateBlock,
  payoutStateOf,
} from "@/lib/game/join-checks";
import AuthorCapabilityNotice from "@/components/AuthorCapabilityNotice";
import {
  launchGoalIssue,
  LAUNCH_GOAL_EXAMPLES,
  wearableGoalNotice,
} from "@/lib/launch-goal-check";
import { COMING_LINE } from "@/lib/provider-capabilities";
import { lockInHint } from "@/lib/game/money-sharing";

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

// Every challenge is a wearable run on a launch goal (lib/launch-goal-check), so
// the one-tap goals are the launch goals, written in the wearable goalSpec
// format ("for 1 night" sets the qualifying days).
const NAME_SUGGESTIONS = LAUNCH_GOAL_EXAMPLES;

// Trash-talk one-liners for the challenge message.
const TRASH_TALK_SUGGESTIONS = [
  "you won't. proving me wrong pays.",
  "put your sleep where your mouth is.",
  "you said Monday. it's Monday.",
  "i've seen you flake before. don't.",
];

const SECONDS_PER_DAY = 86_400;

// Longer copy lives as constants so the JSX stays clean and the apostrophes /
// quotes / dashes render exactly, without escaping.
const PAGE_LEAD_COPY =
  "Stake on your own goal, or put up a reward and challenge a friend. Your wearable decides; the run's contract holds the money.";
const HONESTY_NOTE =
  "Test USDC during beta. Only the yes or no result goes on chain, never the health data.";
const FOOTER_NOTE =
  "Test USDC on Base Sepolia during beta. SPOTTER reads the wearable; the contract pays.";

const CHALLENGE_INITIATIVE = "challenge";
// Both variants are commitment pools (bountyModel 2). See the compliance-lane
// note in the header: forfeited stakes only ever reach peer achievers, so the
// creator never profits from a participant missing, and the contract's H-1 rule
// (every pool carries an entry fee above zero) is satisfied because every player
// stakes on join.
const CHALLENGE_BOUNTY_MODEL = 2;

/** Can SPOTTER record a miss on a stake-on-yourself challenge with this goal?
 *  The goal is written unmarked (wearable only), so the miss rule decides it
 *  from the text (lib/miss-rule.ts). A new run is always past the cutoff. */
function selfRecordsMisses(goal: string): boolean {
  return missRuleWouldApply({ bountyModel: CHALLENGE_BOUNTY_MODEL, goalSpec: goal.trim() });
}

/** A USDC amount typed so far, or 0 while it is empty or half-typed. */
function unitsOf(raw: string): bigint {
  try {
    const units = parseUsdc(raw.trim() === "" ? "0" : raw.trim());
    return units > 0n ? units : 0n;
  } catch {
    return 0n;
  }
}

/**
 * What the other side reads, in the numbers typed so far (docs/MONEY-FLOWS.md):
 * a stake on yourself before anyone matches it (F2, one staker), or a
 * challenge with its reward and one accepter (F3). Nobody is in yet, so no
 * fee can apply to a missed stake.
 */
function draftMoney(input: {
  variant: Variant;
  goal: string;
  amount: string;
  lockIn: string;
  recipient: string;
  /** The challenger's "@handle" when signed in: the preview then reads as
   *  the friend will see it. Null words it for the challenger. */
  fromName?: string | null;
}): RunMoney {
  const isSelf = input.variant === "self";
  const handle = input.recipient.trim().replace(/^@/, "");
  const reward = isSelf ? 0n : unitsOf(input.amount);
  const asFriend = !isSelf && input.fromName !== undefined && input.fromName !== null;
  return runMoneyOf({
    pool: { bountyModel: CHALLENGE_BOUNTY_MODEL, initiative: CHALLENGE_INITIATIVE },
    flow: {
      players: 0,
      creatorStaked: isSelf,
      creatorName: asFriend ? (input.fromName ?? "you") : "you",
      viewerIsCreator: !asFriend,
    },
    numbers: {
      entryFee: isSelf ? unitsOf(input.amount) : unitsOf(input.lockIn),
      players: 0,
      pot: reward,
      feeBps: 0,
      recordable: selfRecordsMisses(input.goal),
      includeJoiner: true,
      confirmBy: null,
    },
    targetName: handle !== "" ? `@${handle}` : null,
    targetIsYou: asFriend,
    reward: isSelf ? null : reward,
  });
}

/** The flow's hit, miss and matching terms as one hint under a field. */
function termsHint(copy: MoneyCopy | null): string | null {
  if (copy === null) return null;
  return copy.terms
    .filter((t) => t.key === "hit" || t.key === "miss" || t.key === "match")
    .map((t) => t.text)
    .join(" ");
}

// Next Links in the shared button looks (components/ui buttonClasses): the
// primary for the go-do-it action, the secondary for "start another".
const CANDY_LINK_PRIMARY =
  `${buttonClasses()}`;
const CANDY_LINK_SECONDARY =
  `${buttonClasses({ variant: "secondary" })}`;

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
// The amount picker's live reaction: SPOTTER's one deadpan line in his caption
// box, keyed to the amount. He never states a number and never claims to hold
// the money (the run's contract does); the amount lives in the field and the
// preview card.
type SpotterMood = { line: string };

function getSpotterMoodForAmount(
  amount: number,
  kind: Variant,
): SpotterMood {
  if (amount < 10) {
    return {
      line:
        kind === "self"
          ? "That's it? I've seen bigger commitment in a gas station burrito."
          : "That reward wouldn't get me off this rock. Just saying.",
    };
  }
  if (amount < 25) {
    return {
      line:
        kind === "self"
          ? "Respectable. Enough to sting if you miss, not enough to cry about."
          : "Solid challenge. They'll feel this one.",
    };
  }
  if (amount < 50) {
    return {
      line:
        kind === "self"
          ? "Now we're talking. I love a person with something to lose."
          : "Okay big spender. They better not miss this one.",
    };
  }
  return {
    line:
      kind === "self"
        ? "That much? The contract holds it. I just read your wearable."
        : "That's a real challenge. The contract holds it until their wearable decides.",
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
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

const IconSelf = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
  </Icon>
);

const IconFriend = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="9" cy="8.5" r="3" />
    <path d="M3.5 19c.7-3 2.8-4.6 5.5-4.6s4.8 1.6 5.5 4.6" />
    <circle cx="16.5" cy="7.5" r="2.5" />
    <path d="M15.5 13.2c2.6-.3 4.4 1.2 5 4" />
  </Icon>
);

const IconLink = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M9 15 15 9" />
    <path d="M11 6.5 13 4.5a4 4 0 0 1 5.5 5.5l-2 2" />
    <path d="M13 17.5 11 19.5a4 4 0 0 1-5.5-5.5l2-2" />
  </Icon>
);

// -------------------------------------------------------------------- amount chips
// A chip row plus a Custom escape hatch. Values stay STRINGS so the existing
// parseUsdc path is untouched (it throws on a half-typed amount, which is why
// the number is only ever read loosely for the mood and the preview).
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
    <div className="[&>*+*]:mt-3">
      <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <Chip
            key={chip}
            role="radio"
            selected={!customOpen && value.trim() === String(chip)}
            onClick={() => {
              setCustomOpen(false);
              onChange(String(chip));
            }}
            className="num"
          >
            {chip} USDC
          </Chip>
        ))}
        <Chip
          role="radio"
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
        <div className="relative max-w-[220px]">
          <input
            type="text"
            inputMode="decimal"
            aria-label={ariaLabel}
            placeholder="Your call"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`${FIELD} num pr-16 font-semibold`}
          />
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[0.9375rem] text-haze">
            USDC
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------- suggestion chip row
function SuggestionRow({
  items,
  value,
  onPick,
  label,
}: {
  items: readonly string[];
  value: string;
  onPick: (value: string) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Chip
          key={item}
          selected={value.trim() === item}
          onClick={() => onPick(item)}
          className="max-w-full whitespace-normal py-2.5 text-left !leading-snug"
        >
          {item}
        </Chip>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- the type picker
// The one clear choice, as two option cards. Selected reads as a lit hairline
// and a raised field; the moon face stays on the one submit button.
function TypePicker({
  value,
  onChange,
}: {
  value: Variant;
  onChange: (v: Variant) => void;
}) {
  // Both start with one staker, so a miss comes back on either until more join.
  const tileMoney: Record<Variant, RunMoney> = {
    self: draftMoney({ variant: "self", goal: "", amount: "", lockIn: "", recipient: "" }),
    dare: draftMoney({ variant: "dare", goal: "", amount: "", lockIn: "", recipient: "" }),
  };
  const options: { id: Variant; title: string; body: string; icon: ReactNode }[] = [
    {
      id: "self",
      title: "Stake on yourself",
      body: "Your own stake on your own goal. With just you in, a miss comes back; friends can match your stake.",
      icon: <IconSelf className="size-5" />,
    },
    {
      id: "dare",
      title: "Challenge a friend",
      body: "You put up the reward, they lock in a small stake. They hit it, they get their stake back plus the reward. Nobody hits, every stake comes back and so does your reward.",
      icon: <IconFriend className="size-5" />,
    },
  ];
  return (
    <div role="radiogroup" aria-label="Whose goal is it" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((opt) => {
        const selected = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.id)}
            className={`${optionCard(selected)} flex flex-col gap-2`}
          >
            <span className="flex items-center justify-between gap-3">
              <span
                className={`flex size-10 items-center justify-center rounded-control ${
                  selected ? "bg-moonlight/15 text-moonlight" : "bg-surface-raised text-muted"
                }`}
              >
                {opt.icon}
              </span>
              <OptionMark selected={selected} />
            </span>
            <span className="text-[1.0625rem] font-semibold leading-tight">{opt.title}</span>
            <MoneyChips kind={tileMoney[opt.id].kind.chip} miss={tileMoney[opt.id].miss} inline />
            <span className="text-[0.9375rem] leading-[1.45] text-muted">{opt.body}</span>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------- the live preview card
// What the other side will see, drawn as the run card itself and updating live
// as the form changes. Money in gold through the Stat primitive; the test-money
// line is small print, never a sticker.
function PreviewCard({
  variant,
  title,
  amount,
  lockIn,
  recipient,
  trashTalk,
  days,
  fromName,
}: {
  variant: Variant;
  title: string;
  amount: string;
  lockIn: string;
  recipient: string;
  trashTalk: string;
  days: number;
  /** The challenger's name when signed in, so a challenge previews as the
   *  friend reads it. */
  fromName: string | null;
}) {
  const isSelf = variant === "self";
  const money = draftMoney({ variant, goal: title, amount, lockIn, recipient, fromName });
  const displayTitle = title.trim() !== "" ? title.trim() : "Pick a goal";
  const displayAmount = amount.trim() !== "" ? amount.trim() : "0";
  const displayLockIn = lockIn.trim() !== "" ? lockIn.trim() : "0";
  const displayTrash =
    trashTalk.trim() !== "" ? trashTalk.trim() : "you won't. proving me wrong pays.";

  return (
    <RunCard
      id="challenge-preview"
      titleAs="h3"
      tag={<MoneyChips kind={money.kind.chip} miss={money.miss} inline />}
      ends={
        <span className="whitespace-nowrap">
          Runs <b>{days} days</b>
        </span>
      }
      title={displayTitle}
      stats={
        <StatRow>
          {isSelf ? (
            <Stat label="Your stake" value={displayAmount} unit="USDC" tone="money" />
          ) : (
            <Stat label="Reward if they hit" value={displayAmount} unit="USDC" tone="money" />
          )}
          {isSelf ? (
            <Stat label="Held by" value={<span className="text-base font-semibold">The run&apos;s contract</span>} />
          ) : (
            <Stat label="Their lock-in" value={displayLockIn} unit="USDC" tone="money" />
          )}
        </StatRow>
      }
      fine={HONESTY_NOTE}
    >
      {money.copy !== null ? (
        <MoneyTermsList copy={money.copy} className="mt-3 border-t border-edge pt-3" />
      ) : null}
      {!isSelf ? (
        <p className="m-0 mt-3 border-l-2 border-moonlight/60 pl-3 text-[0.9375rem] leading-[1.45] text-foreground">
          {displayTrash}
        </p>
      ) : null}
    </RunCard>
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
        className={`flex min-h-[52px] w-full items-center justify-between gap-3 rounded-control bg-surface-deep px-4 py-3 text-left shadow-[inset_0_0_0_1px_var(--border-strong)] hover:shadow-[inset_0_0_0_1px_var(--foreground)] ${FOCUS_RING}`}
      >
        <span className="break-all font-mono text-xs text-muted">{url}</span>
        <span aria-live="polite" className="shrink-0 text-[0.9375rem] font-semibold text-foreground">
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Tap to copy"}
        </span>
      </button>
      {state === "failed" ? (
        <p aria-live="polite" className={FIELD_HINT}>
          Copying is blocked in this browser. Select the link above by hand.
        </p>
      ) : null}
    </>
  );
}

/** A form section inside the composer card: its label, then its controls. */
function FormSection({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <section className="[&>*+*]:mt-3 border-t border-edge pt-5 first:border-t-0 first:pt-0">
      {htmlFor !== undefined ? (
        <label htmlFor={htmlFor} className={SECTION_LABEL}>
          {label}
        </label>
      ) : (
        <h2 className={SECTION_LABEL}>{label}</h2>
      )}
      {children}
    </section>
  );
}

const SECTION_LABEL = "m-0 block text-[1.0625rem] font-semibold leading-tight text-foreground";

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
  // Every challenge is a wearable run on a launch goal (encodeGoal below), so
  // the document checker never gates it. The one thing that can: a verified
  // win that could not pay on this build. Decided before the form and again on
  // submit, never after the deposit.
  const approvalProbe = useApprovalProbe();
  const createBlock = challengeCreateBlock(
    "available",
    payoutStateOf(approvalProbe.mode),
  );
  const goalNotice = wearableGoalNotice(goal);

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
  // The self stake in USDC base units, or null while it is empty, half-typed
  // or zero; parseUsdc throws on a partial amount.
  const selfStakeUnits = ((): bigint | null => {
    if (isDare || stake.trim() === "") return null;
    try {
      const units = parseUsdc(stake.trim());
      return units > 0n ? units : null;
    } catch {
      return null;
    }
  })();
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
          : "I am still checking whether challenges can run right now. Try again in a moment.",
      );
      return;
    }

    let stakeUsdc: bigint;
    let rewardUsdc: bigint;
    try {
      if (goal.trim() === "") {
        throw new Error(
          isDare
            ? "Pick the goal they have to hit, for example \"Sleep at least 7 hours for 1 night\"."
            : "Pick your goal, for example \"Sleep at least 7 hours for 1 night\".",
        );
      }
      // Only goals every supported wearable can verify (lib/provider-capabilities).
      const issue = launchGoalIssue(goal);
      if (issue !== null) throw new Error(issue);
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

  // Shared with both variants. A wearable goal is written unmarked: no proof
  // marker means the wearable floor, and "for 1 night" / "for 1 day" in the
  // text sets the qualifying days (lib/wearable-goal classifyWearableGoal).
  const encodeGoal = (): string => goal.trim();

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
          title: "Challenges are not live here yet",
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
      throw new Error("A funded challenge never deposits again.");
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
      <div className={PAGE_COLUMN}>
        <PerchedHeader
          title="Your commitment is live"
          lead="One step left: lock it in. Nothing has left your wallet yet; you stake by joining your own run."
          pose="thumbsup"
        >
          <Card className="[&>*+*]:mt-4">
            <p className="num m-0 text-[0.9375rem] leading-[1.5] text-muted">
              Put up your{" "}
              <b className="font-semibold text-gold">
                {stake.trim() === "" ? "0" : stake.trim()} USDC
              </b>{" "}
              and you are in.{" "}
              {termsHint(draftMoney({ variant: "self", goal, amount: stake, lockIn: "", recipient: "" }).copy)}
            </p>
            <SpotterCaption line="Locked in. The contract holds the stakes; I just read the wearables." />
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href={`/pools/${phase.poolId}`} className={CANDY_LINK_PRIMARY}>
                Stake to lock in and invite friends
              </Link>
              <button type="button" onClick={clearForm} className={CANDY_LINK_SECONDARY}>
                Start another
              </button>
            </div>
            <Fine>
              On the run page you lock in your stake and can share the run so friends
              stake alongside you, each on their own goal.
            </Fine>
          </Card>
        </PerchedHeader>
      </div>
    );
  }

  if (phase.kind === "dareDone") {
    return (
      <div className={PAGE_COLUMN}>
        <PerchedHeader
          title="Challenge sent"
          lead="The reward is in the run's contract. Send this link to the one person it is for."
          pose="thumbsup"
        >
          <Card className="[&>*+*]:mt-4">
            {address !== null ? (
              <p className="m-0 text-[0.9375rem] text-haze">From {displayName(address)}</p>
            ) : null}
            <p className="m-0 text-[0.9375rem] leading-[1.5] text-muted">
              Whoever opens it can accept, stake their lock-in and go for the goal. Hit
              it and they collect their lock-in back plus your reward when the run
              settles.
            </p>
            <SpotterCaption line="Send them the link. It pays once their wearable proves it." />
            <div className="[&>*+*]:mt-3 border-t border-edge pt-4">
              <h2 className={CARD_TITLE}>Send it to them</h2>
              {/* Web Share / Text / Email, prefilled with the challenge, reward and
                  link. CopyLink stays below as the desktop fallback. */}
              <ShareChallenge
                url={phase.url}
                title="You've been challenged on GoHealthMe"
                message={`I'm challenging you: ${goal.trim()}. Your wearable decides. Hit it and you get ${reward.trim()} test USDC from me.`}
                emailSubject="I'm challenging you on GoHealthMe"
                includeCopy={false}
                shareLabel="Share the challenge"
              />
              <CopyLink url={phase.url} />
              <Fine>
                Anyone with this link can see the challenge and accept it, so send it
                straight to them. It is not listed anywhere and cannot be guessed.
              </Fine>
            </div>
            <div className="flex flex-col gap-3 border-t border-edge pt-4 sm:flex-row sm:flex-wrap">
              <Link href={`/pools/${phase.poolId}`} className={CANDY_LINK_SECONDARY}>
                View the run
              </Link>
              <button type="button" onClick={clearForm} className={CANDY_LINK_SECONDARY}>
                Send another
              </button>
            </div>
          </Card>
        </PerchedHeader>
      </div>
    );
  }

  // A challenge mid-creation (deposit or link step in flight) keeps its form:
  // the block only stops a new one from starting.
  const inFlight = busy || phase.kind === "linking" || phase.kind === "error";
  if (!inFlight && createBlock.kind === "checking") {
    return (
      <div className={PAGE_COLUMN} aria-busy="true">
        <PerchedHeader title="Start a challenge" lead={PAGE_LEAD_COPY} pose="detective">
          <Card>
            <p className="sr-only" aria-live="polite">
              Checking whether challenges can run
            </p>
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="mt-4 h-28 w-full" />
            <Skeleton className="mt-4 h-11 w-2/3" />
          </Card>
        </PerchedHeader>
      </div>
    );
  }
  if (!inFlight && createBlock.kind === "retry") {
    return (
      <div className={PAGE_COLUMN}>
        <PerchedHeader title="Start a challenge" lead={PAGE_LEAD_COPY} pose="thinking">
          <Card>
            <ErrorNote
              title={createBlock.title}
              detail="It did not answer, so no challenge starts on a guess. Nothing has been charged."
              retryLabel="Check again"
              onRetry={() => {
                approvalProbe.refetch();
              }}
            />
          </Card>
        </PerchedHeader>
      </div>
    );
  }
  if (!inFlight && createBlock.kind === "paused") {
    return (
      <div className={PAGE_COLUMN} role="status">
        <PerchedHeader title="Challenges are paused for now" pose="thinking">
          <EmptyCard
            title="No new challenges on this build"
            detail={createBlock.detail}
            action={
              <Link href="/pools" className={CANDY_LINK_PRIMARY}>
                See the open runs
              </Link>
            }
          />
        </PerchedHeader>
      </div>
    );
  }

  const linking = phase.kind === "linking";
  // The reward already landed: the button now only mints the link.
  const retryingLink = isDare && funded !== null;
  // Challenges are refused before any money moves when the link store is not ready.
  const dareBlocked =
    isDare && !retryingLink && (daresOff !== null || checkingDares);
  const fundedPoolId =
    funded !== null && funded.poolId !== null ? funded.poolId.toString() : null;
  const primaryLabel =
    status.kind === "fueling"
      ? "One moment"
      : status.kind === "approving"
      ? "Approving USDC"
      : status.kind === "depositing"
        ? isDare
          ? "Putting up the reward"
          : "Creating your commitment"
        : linking
          ? "Minting the link"
          : !authenticated
            ? "Sign in to start"
            : retryingLink
              ? "Retry the link"
              : isDare
                ? checkingDares
                  ? "Checking challenges are live"
                  : "Send the challenge"
                : "Stake on it";

  return (
    <div className="mx-auto w-full max-w-[68rem]">
      {/* Two columns from 1024px: the title and the composer on the left with
          SPOTTER standing on its edge, the live preview and the one action on
          the right. Stacked on a phone, preview after the form. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-10">
        <PerchedHeader title="Start a challenge" lead={PAGE_LEAD_COPY} pose="wearable" width={[88, 132]}>
          <Card className="[&>*+*]:mt-6">
            <FormSection label="Whose goal is it">
              <TypePicker value={variant} onChange={selectVariant} />
            </FormSection>

            <FormSection label={isDare ? "Pick their goal" : "Pick your goal"} htmlFor="challenge-goal">
              <textarea
                id="challenge-goal"
                placeholder={
                  isDare
                    ? "Complete at least 1 workout for 1 day"
                    : "Sleep at least 7 hours for 1 night"
                }
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={2}
                className={`${FIELD} resize-y`}
              />
              <SuggestionRow
                items={NAME_SUGGESTIONS}
                value={goal}
                onPick={setGoal}
                label="Goals every wearable can check"
              />
              {goalNotice.kind === "launch-issue" ? (
                <Notice tone="limit" role="status">
                  {goalNotice.text}
                </Notice>
              ) : goalNotice.kind === "device-check" ? (
                <AuthorCapabilityNotice goalSpec={goal} noun="challenge" />
              ) : null}
              <p className={FIELD_HINT}>
                {isDare
                  ? "Their wearable proves it. SPOTTER reads the summary, never the raw data, and only the yes or no result goes on chain."
                  : "Your wearable proves it. SPOTTER reads the summary, never the raw data, and only the yes or no result goes on chain."}{" "}
                {COMING_LINE}
              </p>
            </FormSection>

            <FormSection
              label={isDare ? "The reward you're putting up" : "Stake it. How much do you actually mean this?"}
            >
              <AmountChips
                chips={AMOUNT_CHIPS}
                value={headlineAmount}
                onChange={setHeadlineAmount}
                ariaLabel={isDare ? "The reward you put up in USDC" : "Your stake in USDC"}
              />
              <SpotterCaption line={mood.line} live />
              {isDare ? (
                <p className={FIELD_HINT}>
                  Pulled from your wallet now and held in the run&apos;s contract. If
                  nobody hits the goal, you take it back once the run settles.
                </p>
              ) : selfStakeUnits !== null ? (
                // Stake on yourself is a commitment pool (bountyModel 2) with no
                // sponsor money at creation; the creator is the joiner and, until
                // a friend matches, the only staker (docs/MONEY-FLOWS.md F2).
                <p className={FIELD_HINT}>
                  {termsHint(draftMoney({ variant: "self", goal, amount: stake, lockIn: "", recipient: "" }).copy)}
                </p>
              ) : (
                <p className={FIELD_HINT}>Pulled from your wallet when you lock in.</p>
              )}
            </FormSection>

            {isDare ? (
              <>
                <FormSection label="Their lock-in to accept">
                  <AmountChips
                    chips={DARE_LOCKIN_CHIPS}
                    value={stake}
                    onChange={setStake}
                    ariaLabel="Their lock-in in USDC"
                  />
                  <p className={FIELD_HINT}>{lockInHint(selfRecordsMisses(goal))}</p>
                </FormSection>

                <FormSection label="Who's it for">
                  <div role="radiogroup" aria-label="How to send it" className="flex flex-wrap gap-2">
                    <Chip
                      role="radio"
                      selected={recipientMode === "handle"}
                      onClick={() => setRecipientMode("handle")}
                    >
                      Their name
                    </Chip>
                    <Chip
                      role="radio"
                      selected={recipientMode === "link"}
                      onClick={() => {
                        setRecipientMode("link");
                        setTarget("");
                      }}
                    >
                      Just a link
                    </Chip>
                  </div>
                  {recipientMode === "handle" ? (
                    <>
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-base text-haze">
                          @
                        </span>
                        <input
                          type="text"
                          aria-label="Their handle"
                          placeholder="theirhandle"
                          value={target}
                          maxLength={TARGET_HANDLE_MAX}
                          onChange={(e) => setTarget(e.target.value)}
                          className={`${FIELD} pl-9`}
                        />
                      </div>
                      <p className={FIELD_HINT}>
                        They see it under Invited to you in the app. Never made public.
                      </p>
                    </>
                  ) : (
                    <div className="flex items-center gap-2.5 rounded-control bg-fill-quiet px-4 py-3 shadow-[inset_0_0_0_1px_var(--border)]">
                      <IconLink className="size-4 shrink-0 text-haze" />
                      <span className="text-[0.9375rem] text-muted">
                        A private link is made when you send it.
                      </span>
                    </div>
                  )}
                </FormSection>

                <FormSection label="Trash talk (optional, but come on)" htmlFor="trash-talk">
                  <textarea
                    id="trash-talk"
                    placeholder="you won't. proving me wrong pays."
                    value={message}
                    maxLength={MESSAGE_MAX}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={2}
                    className={`${FIELD} resize-y`}
                  />
                  <SuggestionRow
                    items={TRASH_TALK_SUGGESTIONS}
                    value={message}
                    onPick={setMessage}
                    label="Suggested lines"
                  />
                  <p className={FIELD_HINT}>Shown on the challenge link only.</p>
                </FormSection>
              </>
            ) : null}

            <FormSection label={isDare ? "How long they have" : "How long you have"}>
              <div role="radiogroup" aria-label="How long it runs" className="flex flex-wrap gap-2">
                {DURATION_OPTIONS.map((opt) => (
                  <Chip
                    key={opt.days}
                    role="radio"
                    selected={durationDays === opt.days}
                    onClick={() => setDurationDays(opt.days)}
                  >
                    {opt.label}
                  </Chip>
                ))}
              </div>
              <p className={FIELD_HINT}>
                {isDare
                  ? "Starts the moment you send it."
                  : "Starts the moment you create it, so lock in your stake right after."}
              </p>
            </FormSection>
          </Card>
        </PerchedHeader>

        {/* preview + submit column */}
        <div className="[&>*+*]:mt-4 lg:sticky lg:top-24 lg:pt-3">
          <h2 className="m-0 text-[0.9375rem] font-semibold text-muted">What they&apos;ll see</h2>

          <PreviewCard
            variant={variant}
            title={goal}
            amount={headlineAmount}
            lockIn={stake}
            recipient={target}
            trashTalk={message}
            days={durationDays}
            fromName={address !== null ? displayName(address) : null}
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
                block
                aria-busy={busy || linking}
                disabled={!ready || busy || linking || dareBlocked}
                onClick={() => {
                  if (!authenticated) {
                    openSignIn();
                    return;
                  }
                  void submit();
                }}
              >
                {primaryLabel}
              </Button>
            )}
          </SignInGate>
          <Fine className="text-center">{FOOTER_NOTE}</Fine>

          <div aria-live="polite" className="[&>*+*]:mt-3">
            {status.kind === "approving" || status.kind === "depositing" ? (
              <Notice tone="info">
                {isDare ? (
                  <>
                    Step {status.kind === "approving" ? "1" : "2"} of 2:{" "}
                    {status.kind === "approving"
                      ? "approving USDC for the reward"
                      : "putting the reward into the run's contract on Base"}
                  </>
                ) : (
                  "Creating your commitment on Base"
                )}
              </Notice>
            ) : null}

            {linking ? (
              <Notice tone="info">Reward is in. Signing to make your challenge link.</Notice>
            ) : null}

            {isDare && status.kind === "done" ? (
              <Notice tone="ok" title="The reward is in the run's contract">
                <span className="num">
                  Reward of{" "}
                  <b className="font-semibold text-gold">
                    {reward.trim() === "" ? "0" : reward.trim()} USDC
                  </b>
                  .
                </span>
                <div className="mt-1">
                  <ArcTxLink txHash={status.depositHash} label="View the funding tx" />
                </div>
              </Notice>
            ) : null}
          </div>

          {authenticated ? <GaslessBadge status={gasless} /> : null}

          {daresOff !== null && !retryingLink ? (
            <Notice
              tone="limit"
              role="status"
              title="Challenges are not live here yet"
              action={
                <button type="button" onClick={() => selectVariant("self")} className={QUIET_ACTION}>
                  Stake on yourself instead
                </button>
              }
            >
              {daresOff}
            </Notice>
          ) : null}

          {formError !== null ? (
            <ErrorNote
              title="Check the challenge"
              detail={formError}
              retryLabel="Edit the challenge"
              onRetry={() => setFormError(null)}
            />
          ) : null}

          {status.kind === "error" && !retryingLink ? (
            <ErrorNote
              title={isDare ? "Could not put up the reward" : "Could not create your commitment"}
              detail={status.message}
              retryLabel="Try again"
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
            <Notice
              tone="error"
              title="The reward is up, but the link did not send"
              action={
                fundedPoolId !== null ? (
                  <Link href={`/pools/${fundedPoolId}`} className={QUIET_ACTION}>
                    See your run
                  </Link>
                ) : undefined
              }
            >
              <p className="m-0">{phase.message}</p>
              <p className="m-0 mt-1">
                Your reward is safe in the run&apos;s contract. Tap Retry the link: it only
                makes the link and will not charge you again.
              </p>
            </Notice>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function CreateChallenge() {
  if (!DYNAMIC_CONFIGURED) {
    return (
      <div className={PAGE_COLUMN}>
        <PerchedHeader title="Start a challenge" lead={PAGE_LEAD_COPY} pose="meditate">
          <EmptyCard
            title="Sign-in is off on this build"
            detail="Challenges need a signed-in wallet, and this build has sign-in off. Nothing is wrong on your side."
            action={
              <Link href="/pools" className={CANDY_LINK_PRIMARY}>
                See the open runs
              </Link>
            }
          />
        </PerchedHeader>
      </div>
    );
  }
  return <CreateChallengeInner />;
}
