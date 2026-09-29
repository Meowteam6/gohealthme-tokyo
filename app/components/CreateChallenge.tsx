"use client";

// Start a challenge. ONE flow (Andre, 2026-09-27), the commitment game V3
// already played:
//
//   Equal stakes on the same goal. I stake S, my friend matches S. One hits
//   and one misses: the hitter gets their S back plus the other S. Both hit:
//   both get S back. Nobody hits: every stake comes back. Anyone can add
//   extra to the pot; it is split evenly among whoever hits, and if nobody
//   hits it goes to whoever started the challenge (the contract's sweep).
//
// The form reads the goal (launch goals only), the stake S, an optional extra
// E and an optional friend. lib/challenge-flow.ts runs it: preflight, then
// createPool with entryFee S and initialFunding E (a commitment pool,
// bountyModel 2), then the friend's invite. The creator's own S goes in on the
// challenge page (/pools/<id>), through the same join gate every stake uses;
// the two share links ("Match my stake", "Back me") appear there once they
// are in. The preview is the equal-stakes table in the numbers typed so far
// (lib/game/money-flow.ts challengePreviewOf), so what the friend reads and
// what the contract pays can never drift.
//
// WHY MODEL 2 - COMPLIANCE LANE (do not deviate): a commitment pool only ever
// routes a missed stake to a PEER who hit their own goal, and refunds every
// staker when nobody hits. The creator can sweep leftover extra but never
// another player's stake, so nobody profits from a friend failing except by
// hitting their own goal.
//
// The older reward-only variant (the creator put up a reward and did not
// stake) is gone from this form. Those challenges still render and pay; their
// links still work (app/c/[token]).
//
// PRIVACY: the goal ("sleep 7 hours") is health-adjacent. It lives on chain in
// the pool goalSpec and is visible only on the token-gated challenge link and
// the players' own pages; it is never copied into the challenges row and never
// reaches the public feed.
//
// PRESENTATION (docs/DESIGN.md, Night Shift): a two-column composer. The form
// is one card with SPOTTER standing on its edge; the right column is the live
// preview, drawn as the card the friend will see, and the one action.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { formatUsdc, parseUsdc } from "@/lib/contract";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useDisplayNames } from "@/lib/use-display-names";
import { useUsdcDeposit } from "@/lib/useUsdcDeposit";
import GaslessBadge from "@/components/GaslessBadge";
import SignInGate from "@/components/SignInGate";
import { resolveNewPoolId } from "@/lib/resolve-pool-id";
import {
  CHALLENGE_BOUNTY_MODEL,
  fetchChallengesHealth,
  readChallengeForm,
  runChallengeFlow,
  type ChallengeInvite,
  type MintResult,
} from "@/lib/challenge-flow";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { authBlockReason, fetchWithWalletAuth } from "@/lib/client-auth";
import { normalizeTargetHandle, TARGET_HANDLE_MAX } from "@/lib/challenges";
import {
  Button,
  Card,
  Chip,
  ErrorNote,
  Fine,
  RunCard,
  Skeleton,
  Stat,
  StatRow,
  buttonClasses,
} from "@/components/ui";
import SpotterCaption from "@/components/spotter/SpotterCaption";
import {
  EmptyCard,
  FIELD,
  FIELD_HINT,
  Notice,
  PAGE_COLUMN,
  PerchedHeader,
} from "@/components/night/kit";
import { challengePreviewOf } from "@/lib/game/money-flow";
import { MoneyChips, MoneyTermsList } from "@/components/game/MoneyTerms";
import { missRuleWouldApply } from "@/lib/miss-rule";
import { useApprovalProbe } from "@/components/game/ApprovalNote";
import { challengeCreateBlock, payoutStateOf } from "@/lib/game/join-checks";
import AuthorCapabilityNotice from "@/components/AuthorCapabilityNotice";
import { LAUNCH_GOAL_EXAMPLES, wearableGoalNotice } from "@/lib/launch-goal-check";
import { COMING_LINE } from "@/lib/provider-capabilities";

const DURATION_OPTIONS: { label: string; days: number }[] = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "30 days", days: 30 },
];

// Quick picks for the stake. The Custom chip opens a field for any amount.
const STAKE_CHIPS = [5, 10, 25] as const;
// Quick picks for the optional extra; 0 is "No extra".
const EXTRA_CHIPS = [0, 2, 5] as const;

const PAGE_LEAD_COPY =
  "Put money on your own goal and challenge a friend to match it. Your wearable decides; the challenge's contract holds the money.";
const HONESTY_NOTE =
  "Test USDC during beta. Only the yes or no result goes on chain, never the health data.";
const FOOTER_NOTE =
  "Test USDC on Base Sepolia during beta. SPOTTER reads the wearable; the contract pays.";

/** Can SPOTTER record a miss on a challenge with this goal? The goal is
 *  written unmarked (wearable only), so the miss rule decides it from the
 *  text (lib/miss-rule.ts). A new challenge is always past the cutoff. */
function recordsMisses(goal: string): boolean {
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

/** The clock at submit, for the challenge's start. Module scope keeps the
 *  impure read out of the render path; only the submit handler calls it. */
function nowUnixSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

/** "@nikki" for a friend typed so far, or null. */
function friendLabel(raw: string): string | null {
  const handle = normalizeTargetHandle(raw);
  return handle !== "" ? `@${handle}` : null;
}

const LINK_PRIMARY = buttonClasses();
const LINK_SECONDARY = buttonClasses({ variant: "secondary" });

type Phase =
  | { kind: "idle" }
  // The challenge exists. The creator locks in their stake on its page.
  | {
      kind: "created";
      poolId: string;
      joinHref: string;
      stake: bigint;
      extra: bigint;
      invite: ChallengeInvite;
    }
  // Refused before money moved, or created but not found yet.
  | { kind: "error"; title: string; message: string };

// ------------------------------------------------------------------ SPOTTER mood
// The stake picker's live reaction: SPOTTER's one deadpan line, keyed to the
// amount. He never states a number and never claims to hold the money.
function moodLine(amount: number, recordable: boolean): string {
  if (amount < 10) return "That's it? I've seen bigger commitment in a gas station burrito.";
  if (amount < 25) {
    return recordable
      ? "Respectable. Once your friend matches, a miss starts to sting."
      : "Respectable. A miss comes back on this goal, so this one is about the streak.";
  }
  if (amount < 50) return "Now we're talking. I love a person who means it.";
  return "That much? The contract holds it. I just read your wearable.";
}

// -------------------------------------------------------------------- amount chips
// A chip row plus a Custom escape hatch. Values stay STRINGS so the parse is
// loose while typing (parseUsdc throws on a half-typed amount).
function AmountChips({
  chips,
  value,
  onChange,
  ariaLabel,
  zeroLabel,
}: {
  chips: readonly number[];
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  /** The label for a 0 chip ("No extra"). */
  zeroLabel?: string;
}) {
  const presets = chips.map(String);
  const current = value.trim() === "" && chips.includes(0) ? "0" : value.trim();
  const [customOpen, setCustomOpen] = useState(current !== "" && !presets.includes(current));

  return (
    <div className="[&>*+*]:mt-3">
      <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <Chip
            key={chip}
            role="radio"
            selected={!customOpen && current === String(chip)}
            onClick={() => {
              setCustomOpen(false);
              onChange(String(chip));
            }}
            className="num"
          >
            {chip === 0 && zeroLabel !== undefined ? zeroLabel : `${chip} USDC`}
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

// ------------------------------------------------------------- the live preview card
// What the friend will see, drawn as the challenge card itself and updating
// live as the form changes: the stake to match, the one Pot figure with its
// parts in words, and the equal-stakes table.
function PreviewCard({
  goal,
  stake,
  extra,
  friend,
  days,
  fromName,
}: {
  goal: string;
  stake: string;
  extra: string;
  friend: string;
  days: number;
  /** The creator's name when signed in, so the preview reads as the friend
   *  will read it. */
  fromName: string | null;
}) {
  const preview = challengePreviewOf({
    stake: unitsOf(stake),
    extra: unitsOf(extra),
    recordable: recordsMisses(goal),
    creatorName: fromName,
    friendName: friendLabel(friend),
  });
  const title = goal.trim() !== "" ? goal.trim() : "Pick a goal";

  return (
    <RunCard
      id="challenge-preview"
      titleAs="h3"
      tag={<MoneyChips kind={preview.money.kind.chip} miss={preview.money.miss} inline />}
      ends={
        <span className="whitespace-nowrap">
          Lasts <b>{days} days</b>
        </span>
      }
      title={title}
      stats={
        <StatRow>
          <Stat label="Stake each" value={formatUsdc(unitsOf(stake))} unit="USDC" tone="money" />
          <Stat label="Pot" value={formatUsdc(preview.pot)} unit="USDC" tone="money" />
        </StatRow>
      }
      fine={HONESTY_NOTE}
    >
      <p className="m-0 mt-3 text-[1.0625rem] font-semibold leading-snug text-foreground">{preview.headline}</p>
      <p className="num m-0 mt-1.5 text-[0.9375rem] leading-[1.45] text-muted">{preview.potLine}</p>
      {preview.money.copy !== null ? (
        <MoneyTermsList copy={preview.money.copy} skip={["stake"]} className="mt-3 border-t border-edge pt-3" />
      ) : null}
    </RunCard>
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

/** The line under the done screen's lead about the friend's invite. */
function InviteNote({ invite }: { invite: ChallengeInvite }) {
  if (invite.kind === "none") return null;
  if (invite.kind === "sent") {
    return (
      <p className="m-0 text-[0.9375rem] leading-[1.5] text-muted">
        <b className="font-semibold text-foreground">@{invite.targetHandle}</b> sees it under Invited to
        you in the app.
      </p>
    );
  }
  return (
    <Notice tone="limit" role="status" title={`The invite for @${invite.targetHandle} did not save`}>
      {invite.message} Your challenge is fine. Once you lock in, send them the Match my stake link from
      the challenge page.
    </Notice>
  );
}

function CreateChallengeInner() {
  const { ready, authenticated, address } = useEmbeddedWallet();
  const requestAuth = useWalletAuth();
  const { status, busy, reset, runUsdcDeposit, gasless } = useUsdcDeposit();
  const { displayName } = useDisplayNames(address !== null ? [address] : []);

  const [goal, setGoal] = useState("");
  // S: the stake every player puts up, the creator included (pulled on join).
  const [stake, setStake] = useState("10");
  // E: the creator's optional extra in the pot, pulled at create. "" is 0.
  const [extra, setExtra] = useState("");
  const [friend, setFriend] = useState("");
  const [durationDays, setDurationDays] = useState(30);
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  // Can this build make the share links at all? Asked up front so an unready
  // build says so before anything is filled in; runChallengeFlow asks again
  // right before the create, which is the check that actually gates money.
  const healthQuery = useQuery({
    queryKey: ["challenges-health"],
    queryFn: () => fetchChallengesHealth(),
    staleTime: 30_000,
    retry: 1,
  });
  const challengesOff =
    healthQuery.data !== undefined && !healthQuery.data.ok ? healthQuery.data.message : null;
  const checkingChallenges = healthQuery.isLoading;
  // Every challenge is a wearable challenge on a launch goal, so the document
  // checker never gates it. The one thing that can: a verified win that could
  // not pay on this build. Decided before the form and again on submit, never
  // after money moves.
  const approvalProbe = useApprovalProbe();
  const createBlock = challengeCreateBlock("available", payoutStateOf(approvalProbe.mode));
  const goalNotice = wearableGoalNotice(goal);

  const stakeNum = Number(stake.trim()) || 0;
  const extraUnits = unitsOf(extra);
  const mood = moodLine(stakeNum, recordsMisses(goal));

  const clearForm = () => {
    reset();
    setPhase({ kind: "idle" });
    setGoal("");
    setStake("10");
    setExtra("");
    setFriend("");
    setDurationDays(30);
  };

  // Write the invite row naming the friend, for a pool that already exists.
  // Signed, and never throws on a refusal: every failure is a message.
  const mintInvite = async (poolId: bigint, targetHandle: string): Promise<MintResult> => {
    if (address === null) {
      return { ok: false, message: "Your wallet disconnected before the invite could be signed." };
    }
    const sent = await fetchWithWalletAuth(
      "/api/challenges",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, poolId: poolId.toString(), targetHandle, message: null }),
      },
      requestAuth,
    );
    if (!sent.response.ok) {
      if (sent.auth.kind !== "ok") {
        return { ok: false, message: authBlockReason(sent.auth) ?? "Sign with your wallet to send the invite." };
      }
      const body = (await sent.response.json().catch(() => ({}))) as { error?: string };
      return { ok: false, message: body.error ?? "Could not save the invite." };
    }
    const body = (await sent.response.json().catch(() => ({}))) as {
      challenge?: { inviteToken?: string };
    };
    const token = body.challenge?.inviteToken;
    return typeof token === "string" && token !== ""
      ? { ok: true, token }
      : { ok: false, message: "The invite came back empty." };
  };

  const submit = async () => {
    setFormError(null);
    setPhase({ kind: "idle" });
    if (createBlock.kind !== "ok") {
      setFormError(
        createBlock.kind === "paused"
          ? createBlock.detail
          : "I am still checking whether new challenges can start right now. Try again in a moment.",
      );
      return;
    }
    const read = readChallengeForm({ goal, stake, extra, friend });
    if (!read.ok) {
      setFormError(read.reason);
      return;
    }
    const result = await runChallengeFlow(
      {
        checkHealth: () => fetchChallengesHealth(),
        deposit: (amount, call) => runUsdcDeposit(amount, call),
        resolvePoolId: (hash) => resolveNewPoolId(hash),
        mintInvite: (poolId, handle) => mintInvite(poolId, handle),
      },
      { form: read.form, durationDays, nowSeconds: nowUnixSeconds() },
    );
    switch (result.kind) {
      case "unavailable":
        setPhase({ kind: "error", title: "Challenges are not live here yet", message: result.message });
        return;
      case "depositFailed":
        // Nothing moved. The deposit status note already says why.
        setPhase({ kind: "idle" });
        return;
      case "unresolved":
        setPhase({
          kind: "error",
          title: "Your challenge was created",
          message:
            read.form.extra > 0n
              ? "Your extra is in its pot, but we could not open it yet. Find it under My challenges and lock in your stake from there."
              : "Nothing left your wallet, but we could not open it yet. Find it under My challenges and lock in your stake from there.",
        });
        return;
      case "created":
        setPhase({
          kind: "created",
          poolId: result.poolId.toString(),
          joinHref: result.joinHref,
          stake: result.stake,
          extra: result.extra,
          invite: result.invite,
        });
    }
  };

  if (phase.kind === "created") {
    const s = formatUsdc(phase.stake);
    return (
      <div className={PAGE_COLUMN}>
        <PerchedHeader
          title="Your challenge is set"
          lead={
            phase.extra > 0n
              ? `Your ${formatUsdc(phase.extra)} USDC extra is in the pot. One step left: lock in your ${s} USDC stake.`
              : `One step left: lock in your ${s} USDC stake. Nothing has left your wallet yet.`
          }
          pose="thumbsup"
        >
          <Card className="[&>*+*]:mt-4">
            <p className="num m-0 text-[0.9375rem] leading-[1.5] text-muted">
              Stake <b className="font-semibold text-gold">{s} USDC</b> on the challenge page. Right after,
              you get two links to send: <b className="font-semibold text-foreground">Match my stake</b>, for a
              friend to put in the same {s}, and <b className="font-semibold text-foreground">Back me</b>, for
              anyone to add to the pot.
            </p>
            <InviteNote invite={phase.invite} />
            <SpotterCaption line="Lock it in. The contract holds the stakes; I just read the wearables." />
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href={phase.joinHref} className={LINK_PRIMARY}>
                Stake {s} USDC to lock in
              </Link>
              <button type="button" onClick={clearForm} className={LINK_SECONDARY}>
                Start another
              </button>
            </div>
            <Fine>
              Your stake goes in through the same checks every player passes, so the challenge page
              tells you if anything is missing before any money moves.
            </Fine>
          </Card>
        </PerchedHeader>
      </div>
    );
  }

  // A challenge mid-creation keeps its form: the block only stops a new one.
  const inFlight = busy || phase.kind === "error";
  if (!inFlight && createBlock.kind === "checking") {
    return (
      <div className={PAGE_COLUMN} aria-busy="true">
        <PerchedHeader title="Start a challenge" lead={PAGE_LEAD_COPY} pose="detective">
          <Card>
            <p className="sr-only" aria-live="polite">
              Checking whether new challenges can start
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
              <Link href="/pools" className={LINK_PRIMARY}>
                See the open challenges
              </Link>
            }
          />
        </PerchedHeader>
      </div>
    );
  }

  const blocked = challengesOff !== null || checkingChallenges;
  const primaryLabel =
    status.kind === "fueling"
      ? "One moment"
      : status.kind === "approving"
        ? "Approving USDC"
        : status.kind === "depositing"
          ? "Creating your challenge"
          : !authenticated
            ? "Sign in to start"
            : checkingChallenges
              ? "Checking challenges are live"
              : "Start the challenge";
  const fromName = address !== null ? displayName(address) : null;
  const friendName = friendLabel(friend);

  return (
    <div className="mx-auto w-full max-w-[68rem]">
      {/* Two columns from 1024px: the composer on the left with SPOTTER
          standing on its edge, the live preview and the one action on the
          right. Stacked on a phone, preview after the form. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-10">
        <PerchedHeader title="Start a challenge" lead={PAGE_LEAD_COPY} pose="wearable" width={[88, 132]}>
          <Card className="[&>*+*]:mt-6">
            <FormSection label="Pick your goal" htmlFor="challenge-goal">
              <textarea
                id="challenge-goal"
                placeholder="Sleep at least 7 hours for 1 night"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={2}
                className={`${FIELD} resize-y`}
              />
              <SuggestionRow
                items={LAUNCH_GOAL_EXAMPLES}
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
                You and your friend go for the same goal, each on your own wearable. SPOTTER reads the
                summary, never the raw data, and only the yes or no result goes on chain. {COMING_LINE}
              </p>
            </FormSection>

            <FormSection label="Your stake. Your friend matches it.">
              <AmountChips chips={STAKE_CHIPS} value={stake} onChange={setStake} ariaLabel="Your stake in USDC" />
              <SpotterCaption line={mood} live />
              <p className={FIELD_HINT}>
                Pulled from your wallet when you lock in on the challenge page. Your friend puts in the
                same amount.
              </p>
            </FormSection>

            <FormSection label="Add extra to the pot (optional)">
              <AmountChips
                chips={EXTRA_CHIPS}
                value={extra}
                onChange={setExtra}
                ariaLabel="Extra you add to the pot in USDC"
                zeroLabel="No extra"
              />
              <p className={FIELD_HINT}>
                {extraUnits > 0n
                  ? `Pulled from your wallet when you start the challenge. Split among whoever hits; if nobody hits, you take the ${formatUsdc(extraUnits)} back once the challenge settles.`
                  : "Sweeten it if you like. Anything extra is split among whoever hits, and friends can add more with your Back me link."}
              </p>
            </FormSection>

            <FormSection label="Challenge a friend (optional)" htmlFor="challenge-friend">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-base text-haze">
                  @
                </span>
                <input
                  id="challenge-friend"
                  type="text"
                  placeholder="theirhandle"
                  value={friend}
                  maxLength={TARGET_HANDLE_MAX}
                  onChange={(e) => setFriend(e.target.value)}
                  className={`${FIELD} pl-9`}
                />
              </div>
              <p className={FIELD_HINT}>
                They see it under Invited to you. Never made public. Leave it blank and send the Match my
                stake link once you lock in.
              </p>
            </FormSection>

            <FormSection label="How long you have">
              <div role="radiogroup" aria-label="How long it lasts" className="flex flex-wrap gap-2">
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
              <p className={FIELD_HINT}>Starts the moment you create it, so lock in your stake right after.</p>
            </FormSection>
          </Card>
        </PerchedHeader>

        {/* preview + submit column */}
        <div className="[&>*+*]:mt-4 lg:sticky lg:top-24 lg:pt-3">
          <h2 className="m-0 text-[0.9375rem] font-semibold text-muted">
            {fromName !== null ? `What ${friendName ?? "your friend"} will see` : "Your challenge"}
          </h2>

          <PreviewCard
            goal={goal}
            stake={stake}
            extra={extra}
            friend={friend}
            days={durationDays}
            fromName={fromName}
          />

          <SignInGate note="Sign in to start your challenge.">
            {(openSignIn) => (
              <Button
                type="button"
                block
                aria-busy={busy}
                disabled={!ready || busy || (authenticated && blocked)}
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
                {extraUnits > 0n ? (
                  <>
                    Step {status.kind === "approving" ? "1" : "2"} of 2:{" "}
                    {status.kind === "approving"
                      ? "approving USDC for the extra"
                      : "creating your challenge with the extra in its pot on Base"}
                  </>
                ) : (
                  "Creating your challenge on Base"
                )}
              </Notice>
            ) : null}
          </div>

          {authenticated ? <GaslessBadge status={gasless} /> : null}

          {challengesOff !== null ? (
            <Notice tone="limit" role="status" title="Challenges are not live here yet">
              {challengesOff}
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

          {status.kind === "error" ? (
            <ErrorNote
              title="Could not create your challenge"
              detail={status.message}
              retryLabel="Try again"
              onRetry={reset}
            />
          ) : null}

          {phase.kind === "error" ? (
            <ErrorNote title={phase.title} detail={phase.message} onRetry={() => setPhase({ kind: "idle" })} />
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
              <Link href="/pools" className={LINK_PRIMARY}>
                See the open challenges
              </Link>
            }
          />
        </PerchedHeader>
      </div>
    );
  }
  return <CreateChallengeInner />;
}
