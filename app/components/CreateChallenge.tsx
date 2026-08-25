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

import { useEffect, useState } from "react";
import Link from "next/link";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { parseUsdc, withDocMarker, withProofPolicy } from "@/lib/contract";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useDisplayNames } from "@/lib/use-display-names";
import { useUsdcDeposit } from "@/lib/useUsdcDeposit";
import ShareChallenge from "@/components/ShareChallenge";
import SignInGate from "@/components/SignInGate";
import { resolveNewPoolId } from "@/lib/resolve-pool-id";
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
import { ArcTxLink, ErrorNote, Money } from "@/components/ui";

const DURATION_OPTIONS: { label: string; days: number }[] = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "30 days", days: 30 },
];

const SECONDS_PER_DAY = 86_400;

const CHALLENGE_INITIATIVE = "challenge";
// Both variants are commitment pools (bountyModel 2). See the compliance-lane
// note in the header: forfeited stakes only ever reach peer achievers, so the
// creator never profits from a participant missing, and the contract's H-1 rule
// (every pool carries an entry fee above zero) is satisfied because every player
// stakes on join.
const CHALLENGE_BOUNTY_MODEL = 2;

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
  | { kind: "error"; message: string };

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

function CreateChallengeInner() {
  const { ready, authenticated, address } = useEmbeddedWallet();
  const requestAuth = useWalletAuth();
  const { status, busy, reset, runUsdcDeposit } = useUsdcDeposit();
  // The challenger's own name, for the "from @you" line on the done screen.
  const { displayName } = useDisplayNames(address !== null ? [address] : []);

  const [variant, setVariant] = useState<Variant>("dare");
  const [goal, setGoal] = useState("");
  // The stake every player puts up on their OWN goal, pulled on join. For SELF
  // this is the creator's own stake; for DARE it is the friend's lock-in.
  const [stake, setStake] = useState("");
  // DARE only: the reward the challenger seeds at creation.
  const [reward, setReward] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState("");
  // Off by default: a challenge stays a document-floor pool (byte-identical to
  // today) unless the creator explicitly opts into accepting a self-reported
  // photo, which loosens the floor to also allow the low-trust tier.
  const [acceptSelf, setAcceptSelf] = useState(false);
  const [durationDays, setDurationDays] = useState(30);
  const [formError, setFormError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  // Preselect the variant from ?v=self|dare so the challenges landing can send a
  // "Stake on yourself" tap straight to that mode. Read in an effect (not the
  // initial state) so the first client render matches the server and never
  // mismatches on hydration; the default stays "dare".
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = new URLSearchParams(window.location.search).get("v");
    if (v === "self" || v === "dare") setVariant(v);
  }, []);

  const isDare = variant === "dare";

  const clearForm = () => {
    reset();
    setPhase({ kind: "idle" });
    setGoal("");
    setStake("");
    setReward("");
    setMessage("");
    setTarget("");
    setAcceptSelf(false);
  };

  const submit = async () => {
    setFormError(null);
    setPhase({ kind: "idle" });

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
      const poolId = await resolveNewPoolId(depositHash);
      setPhase({ kind: "selfDone", poolId: poolId.toString() });
    } catch {
      // useUsdcDeposit already captured any error into status; surface there.
      if (status.kind !== "error") {
        setPhase({
          kind: "error",
          message: "Could not create your commitment. Try again.",
        });
      }
    }
  };

  // DARE A FRIEND: seed the reward at creation, then mint the person-aimed link.
  const submitDare = async (
    stakeUsdc: bigint,
    rewardUsdc: bigint,
    invite: { message: string | null; targetHandle: string | null },
  ) => {
    const { periodStart, periodEnd } = periodBounds();
    try {
      const depositHash = await runUsdcDeposit(rewardUsdc, {
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
      });

      // The pool is funded on-chain. Now mint the shareable, person-aimed link.
      setPhase({ kind: "linking" });
      const poolId = await resolveNewPoolId(depositHash);

      if (address === null) {
        setPhase({
          kind: "error",
          message: "Your wallet disconnected before the link could be signed.",
        });
        return;
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
          setPhase({
            kind: "error",
            message:
              authBlockReason(sent.auth) ??
              "Sign with your wallet to send this challenge.",
          });
          return;
        }
        const body = (await sent.response.json().catch(() => ({}))) as {
          error?: string;
        };
        // The pool is already funded and live; the link write is what failed.
        // Point the challenger at their pool so the money is never stranded.
        setPhase({
          kind: "error",
          message:
            (body.error ?? "Could not create the challenge link.") +
            ` Your pool is live at /pools/${poolId.toString()} - you can still share that.`,
        });
        return;
      }

      const body = (await sent.response.json()) as {
        challenge?: { inviteToken?: string };
        sharePath?: string;
      };
      const token = body.challenge?.inviteToken;
      if (typeof token !== "string" || token === "") {
        setPhase({
          kind: "error",
          message: "The challenge was created but its link came back empty.",
        });
        return;
      }
      const origin =
        typeof window === "undefined" ? "" : window.location.origin;
      setPhase({
        kind: "dareDone",
        url: challengeShareUrl(origin, token),
        poolId: poolId.toString(),
      });
    } catch {
      // useUsdcDeposit already captured any deposit error into status; surface
      // there. A post-deposit throw lands as a generic link error.
      if (status.kind !== "error") {
        setPhase({
          kind: "error",
          message: "Could not finish creating the challenge. Try again.",
        });
      }
    }
  };

  if (phase.kind === "selfDone") {
    return (
      <div className="space-y-5">
        <div className="space-y-2 rounded-2xl border border-accent/40 bg-accent-deep/40 p-5">
          <p className="text-base font-semibold text-accent">
            Your commitment is live. One tap to lock it in.
          </p>
          <p className="text-sm text-foreground/80">
            Nothing left your wallet yet - you stake by joining your own pool.
            Put up your <Money usd={stake.trim()} /> and you are in: hit the goal
            and it comes back with a cut of what everyone who flaked forfeited.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/pools/${phase.poolId}`}
            className="rounded-xl bg-accent-strong px-5 py-3 text-sm font-semibold text-background hover:bg-accent"
          >
            Stake to lock in and invite friends
          </Link>
          <button
            type="button"
            onClick={clearForm}
            className="rounded-xl border border-edge px-5 py-3 text-sm font-medium text-muted hover:text-foreground"
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
      <div className="space-y-5">
        <div className="space-y-2 rounded-2xl border border-accent/40 bg-accent-deep/40 p-5">
          <p className="text-base font-semibold text-accent">
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
        </div>

        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
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
          <Link
            href={`/pools/${phase.poolId}`}
            className="rounded-xl border border-edge px-5 py-3 text-sm font-medium text-muted hover:text-foreground"
          >
            View the pool
          </Link>
          <button
            type="button"
            onClick={clearForm}
            className="rounded-xl border border-edge px-5 py-3 text-sm font-medium text-muted hover:text-foreground"
          >
            Send another
          </button>
        </div>
      </div>
    );
  }

  const linking = phase.kind === "linking";
  const primaryLabel =
    status.kind === "approving"
      ? "Approving USDC..."
      : status.kind === "depositing"
        ? isDare
          ? "Putting up the reward..."
          : "Creating your commitment..."
        : linking
          ? "Minting the link..."
          : !authenticated
            ? "Sign in to start"
            : isDare
              ? "Put up the reward and send the dare"
              : "Create my commitment";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Start a challenge
        </h1>
        <p className="mt-2 text-sm text-muted">
          Put real USDC behind a goal - yours or a friend&apos;s. Nobody ever
          sees the health data, only the verdict.
        </p>
      </div>

      {/* The one clear choice. Both build a commitment pool; the difference is
          whose goal it is and whether you seed a reward. */}
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => {
            setVariant("self");
            setFormError(null);
          }}
          aria-pressed={!isDare}
          className={`rounded-2xl border p-4 text-left ${
            !isDare
              ? "border-accent/60 bg-accent-deep/40"
              : "border-edge bg-surface hover:border-accent/40"
          }`}
        >
          <p className="text-sm font-semibold">Stake on yourself</p>
          <p className="mt-1 text-xs text-muted">
            Your USDC on your own goal. Hit it, get it back plus a cut of the
            forfeits.
          </p>
        </button>
        <button
          type="button"
          onClick={() => {
            setVariant("dare");
            setFormError(null);
          }}
          aria-pressed={isDare}
          className={`rounded-2xl border p-4 text-left ${
            isDare
              ? "border-accent/60 bg-accent-deep/40"
              : "border-edge bg-surface hover:border-accent/40"
          }`}
        >
          <p className="text-sm font-semibold">Dare a friend</p>
          <p className="mt-1 text-xs text-muted">
            You put up a reward. They stake a small lock-in, hit it, and collect
            both.
          </p>
        </button>
      </div>

      <div className="space-y-4 rounded-2xl border border-edge bg-surface p-5">
        <p className="text-sm leading-relaxed text-muted">
          {isDare ? (
            <>
              You fund the reward. They put up a small lock-in to accept, so
              every player has skin in the game - hit the goal and they get the
              lock-in back plus your reward, the moment it is verified. If the
              pool ends with no winner, everyone is refunded and your reward
              comes back to you. You never keep their stake.
            </>
          ) : (
            <>
              You put your own USDC on your own goal. Hit it during the window
              and your stake comes back plus an equal cut of what everyone who
              flaked forfeited. If nobody in the pool hits it, everyone is
              refunded. You are only ever up against your own goal.
            </>
          )}
        </p>

        <label className="block text-sm font-medium">
          {isDare ? "The dare" : "Your goal"}
          <textarea
            placeholder={isDare ? "lose 10 lbs this month" : "sleep 8h a night for 2 weeks"}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-xl border border-edge bg-surface-raised px-3 py-3 text-base"
          />
          <span className="mt-1 block text-xs text-muted">
            {isDare
              ? "What they have to do. Proven by an uploaded record - the reward pays the moment it is verified in a confidential enclave."
              : "What you are going to do. Proven by an uploaded record - verified in a confidential enclave, so nobody ever sees your health data."}
          </span>
        </label>

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

        {isDare ? (
          <label className="block text-sm font-medium">
            The reward you put up (USDC)
            <input
              type="text"
              inputMode="decimal"
              placeholder="50.00"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              className="mt-1 w-full rounded-xl border border-edge bg-surface-raised px-3 py-3 text-base"
            />
            <span className="mt-1 block text-xs text-muted">
              Pulled from your wallet now and held in the pool. If the pool ends
              with no winner, you reclaim it.
            </span>
          </label>
        ) : null}

        <label className="block text-sm font-medium">
          {isDare ? "Their lock-in to accept (USDC)" : "Your stake (USDC)"}
          <input
            type="text"
            inputMode="decimal"
            placeholder={isDare ? "5.00" : "25.00"}
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            className="mt-1 w-full rounded-xl border border-edge bg-surface-raised px-3 py-3 text-base"
          />
          <span className="mt-1 block text-xs text-muted">
            {isDare
              ? "The small amount they put up to lock in - real money keeps the goal honest. They get it back when they hit the goal, and you never pocket it."
              : "Pulled from your wallet when you lock in. Hit the goal and it comes back with a cut of the forfeits; miss and it goes to whoever did."}
          </span>
        </label>

        {isDare ? (
          <>
            <label className="block text-sm font-medium">
              Who is it for (optional)
              <input
                type="text"
                placeholder="@handle"
                value={target}
                maxLength={TARGET_HANDLE_MAX}
                onChange={(e) => setTarget(e.target.value)}
                className="mt-1 w-full rounded-xl border border-edge bg-surface-raised px-3 py-3 text-base"
              />
              <span className="mt-1 block text-xs text-muted">
                Enter their @handle and they will see this under Invited to you
                in the app. Leave blank to just share the link. Never made
                public.
              </span>
            </label>

            <label className="block text-sm font-medium">
              A message (optional)
              <textarea
                placeholder="bet you can't. proving me wrong pays."
                value={message}
                maxLength={MESSAGE_MAX}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-xl border border-edge bg-surface-raised px-3 py-3 text-base"
              />
              <span className="mt-1 block text-xs text-muted">
                Trash talk, encouragement, whatever lands. Shown on the challenge
                link only.
              </span>
            </label>
          </>
        ) : null}

        <div className="block text-sm font-medium">
          {isDare ? "How long they have" : "How long you have"}
          <div className="mt-2 flex flex-wrap gap-2">
            {DURATION_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                type="button"
                onClick={() => setDurationDays(opt.days)}
                className={`rounded-xl border px-4 py-2 text-sm font-medium ${
                  durationDays === opt.days
                    ? "border-accent/50 bg-accent-deep text-accent"
                    : "border-edge bg-surface-raised text-muted hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span className="mt-1 block text-xs text-muted">
            {isDare
              ? "Starts the moment you send it."
              : "Starts the moment you lock in your stake."}
          </span>
        </div>

        <SignInGate
          note={
            isDare
              ? "Sign in to send this challenge."
              : "Sign in to start your commitment."
          }
        >
          {(openSignIn) => (
            <button
              type="button"
              disabled={!ready || busy || linking}
              onClick={() => {
                if (!authenticated) {
                  openSignIn();
                  return;
                }
                void submit();
              }}
              className="w-full rounded-xl bg-accent-strong px-5 py-3.5 text-base font-semibold text-background hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {primaryLabel}
            </button>
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

        {linking ? (
          <div className="rounded-xl border border-edge bg-surface-raised p-4 text-sm">
            <p className="font-medium">
              Reward is in. Signing to mint your challenge link...
            </p>
          </div>
        ) : null}

        {isDare && status.kind === "done" ? (
          <div className="space-y-1 rounded-xl border border-accent/40 bg-accent-deep/40 p-4">
            <p className="text-sm font-semibold text-accent">
              Reward of <Money usd={reward.trim()} /> is in the pool.
            </p>
            <ArcTxLink
              txHash={status.depositHash}
              label="View the funding tx"
            />
          </div>
        ) : null}

        {formError !== null ? (
          <ErrorNote
            title="Check the challenge"
            detail={formError}
            onRetry={() => setFormError(null)}
          />
        ) : null}

        {status.kind === "error" ? (
          <ErrorNote
            title={
              isDare ? "Could not put up the reward" : "Could not create your commitment"
            }
            detail={status.message}
            onRetry={reset}
          />
        ) : null}

        {phase.kind === "error" ? (
          <ErrorNote
            title={
              isDare
                ? "The reward is up, but the link did not send"
                : "Could not create your commitment"
            }
            detail={phase.message}
            onRetry={() => setPhase({ kind: "idle" })}
          />
        ) : null}
      </div>
    </div>
  );
}

export default function CreateChallenge() {
  if (!DYNAMIC_CONFIGURED) {
    return (
      <ErrorNote
        title="Sign-in is not configured"
        detail="Set NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID to enable challenges with an embedded wallet."
      />
    );
  }
  return <CreateChallengeInner />;
}
