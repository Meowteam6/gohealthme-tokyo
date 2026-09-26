"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import {
  getHealthPoolsAddress,
  parseUsdc,
  withProofPolicy,
  type Modality,
} from "@/lib/contract";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useDocumentProofAvailable } from "@/lib/useProofStatus";
import AuthorCapabilityNotice from "@/components/AuthorCapabilityNotice";
import { launchGoalIssue, LAUNCH_GOAL_EXAMPLES, wearableGoalNotice } from "@/lib/launch-goal-check";
import { COMING_LINE } from "@/lib/provider-capabilities";
import { useUsdcDeposit } from "@/lib/useUsdcDeposit";
import { isEconomicallyDeadConfig } from "@/lib/pool-lifecycle";
import { resolveNewPoolId } from "@/lib/resolve-pool-id";
import { ArcTxLink, Button, Chip, EmptyState, ErrorNote } from "@/components/ui";
import { CommitmentRangeLine } from "@/components/CommitmentTerms";
import Spotter from "@/components/spotter/Spotter";
import GaslessBadge from "@/components/GaslessBadge";
import SignInGate from "@/components/SignInGate";

const DURATION_OPTIONS: { label: string; days: number }[] = [
  { label: "1 day", days: 1 },
  { label: "3 days", days: 3 },
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
];

const SECONDS_PER_DAY = 86_400;

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2";
const OPTION = `min-h-11 rounded-2xl border-2 p-3 text-left ${FOCUS_RING}`;
const OPTION_ON = "border-foreground bg-surface text-foreground";
const OPTION_OFF =
  "border-edge bg-surface-raised text-foreground hover:border-foreground/40";
const FIELD = `mt-1 w-full rounded-2xl border border-edge bg-surface-raised px-3 py-3 text-base ${FOCUS_RING}`;

interface DocTemplate {
  key: string;
  label: string;
  initiative: string;
  goal: string;
  entryFee: string;
  funding: string;
}

/**
 * One-tap preventive-care templates for document-verified goals, modeled on
 * the UnitedHealthcare rewards catalog (flu shot, biometric screening, lipid
 * panel). Selecting one prefills the form; the goal text is encoded as a
 * document goal at submit time via withDocMarker.
 *
 * Entry fees were 0.00 in the Arc era ("free to join"), but the deployed
 * HealthPoolsV3 reverts DEAD_CONFIG on any zero entry fee (H-1: every winner
 * must have staked), so free-to-join pools cannot exist on this contract.
 * The templates now prefill the smallest stake that reads as real (1.00) -
 * achievers get it back as part of their split-pot share.
 */
const DOC_TEMPLATES: DocTemplate[] = [
  {
    key: "flu-shot",
    label: "Get your flu shot",
    initiative: "flu-shot",
    goal: "Get your annual flu shot and upload your vaccination record showing the date.",
    entryFee: "1.00",
    funding: "10.00",
  },
  {
    key: "biometric",
    label: "Biometric screening",
    initiative: "biometric",
    goal: "Complete a biometric screening and upload the result document (blood pressure, BMI, glucose).",
    entryFee: "1.00",
    funding: "50.00",
  },
  {
    key: "cholesterol",
    label: "Cholesterol panel under 200",
    initiative: "cholesterol",
    goal: "Upload a lab report showing total cholesterol under 200 mg/dL.",
    entryFee: "1.00",
    funding: "25.00",
  },
];

function CreatePoolInner() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ready, authenticated } = useEmbeddedWallet();
  const { status, busy, reset, runUsdcDeposit, gasless } = useUsdcDeposit();

  // The proof floor (highest-trust modality required) and whether the pool ALSO
  // opts into accepting self-reported photos. Default floor is wearable with no
  // self-reported opt-in, so a pool created without touching this control
  // serializes to a byte-identical unmarked goalSpec, exactly as before.
  const [floor, setFloor] = useState<Modality>("wearable");
  const docAvailable = useDocumentProofAvailable();
  const [acceptSelfReported, setAcceptSelfReported] = useState<boolean>(false);
  const [initiative, setInitiative] = useState<string>("");
  const [goalSpec, setGoalSpec] = useState<string>("");
  const goalNotice = wearableGoalNotice(goalSpec);
  const [entryFee, setEntryFee] = useState<string>("");
  const [durationDays, setDurationDays] = useState<number>(7);
  const [bountyModel, setBountyModel] = useState<number>(0);
  const [initialFunding, setInitialFunding] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState<boolean>(false);

  const poolsAddress = getHealthPoolsAddress();
  if (poolsAddress === null) {
    return (
      <EmptyState
        pose="lounging"
        line="No pond to put a run in. I'm on break."
        title="Runs are off on this build"
        detail="Starting a run is not switched on for this build yet. Nothing is wrong on your side."
        action={
          <Link href="/pools" className="inline-flex min-h-12 items-center justify-center rounded-[18px] bg-accent px-5 py-3 text-base font-bold text-foreground shadow-[var(--shadow-pop)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2">
            Go to the lobby
          </Link>
        }
      />
    );
  }

  const applyTemplate = (template: DocTemplate) => {
    // Templates are document goals; nothing to apply while the verifier is off.
    if (!docAvailable) return;
    setFloor("document");
    setInitiative(template.initiative);
    setGoalSpec(template.goal);
    setEntryFee(template.entryFee);
    // Templates are sponsor-seeded rewards, so they split the pot: achievers
    // share the bounty (plus the returned stakes) in proportion to results.
    setBountyModel(1);
    setInitialFunding(template.funding);
    setFormError(null);
  };

  // The deployed contract rejects a zero entry fee for EVERY payout model
  // (DEAD_CONFIG - every winner must have staked), so a zero fee is not a
  // model-selection problem, it is an invalid form. Warn at the fee field
  // while typing and block at submit; the runUsdcDeposit funnel backstops it.
  const feeIsZero = (() => {
    try {
      return parseUsdc(entryFee.trim() === "" ? "0" : entryFee.trim()) === 0n;
    } catch {
      return false;
    }
  })();

  // Parsed amounts for the commitment range line; null while the field does
  // not parse, so the line simply hides instead of guessing.
  const parsedOrNull = (raw: string): bigint | null => {
    try {
      return parseUsdc(raw.trim() === "" ? "0" : raw.trim());
    } catch {
      return null;
    }
  };
  const entryFeeParsed = parsedOrNull(entryFee);
  const fundingParsed = parsedOrNull(initialFunding) ?? 0n;

  // A self-staked commitment pool can be created with no sponsor seed, so the
  // primary button honestly says "Create pool" (no funding to approve) rather
  // than "Approve funding and create pool" when the seed is zero.
  const fundingIsZero = (() => {
    try {
      return (
        parseUsdc(
          initialFunding.trim() === "" ? "0" : initialFunding.trim(),
        ) === 0n
      );
    } catch {
      return false;
    }
  })();

  const submit = async () => {
    setFormError(null);
    let entryFeeUsdc: bigint;
    let fundingUsdc: bigint;

    try {
      if (initiative.trim() === "") {
        throw new Error("Enter an initiative name, for example \"sleep\".");
      }
      if (goalSpec.trim() === "") {
        throw new Error("Describe the goal participants must hit.");
      }
      if (floor === "wearable") {
        // Only goals every supported sensor can verify (lib/provider-capabilities).
        const issue = launchGoalIssue(goalSpec);
        if (issue !== null) throw new Error(issue);
      }
      entryFeeUsdc = parseUsdc(entryFee.trim() === "" ? "0" : entryFee.trim());
      // The deployed contract reverts DEAD_CONFIG on a zero entry fee for
      // every payout model (every winner must have staked), so catch it here
      // with a plain message instead of sending a doomed transaction.
      if (entryFeeUsdc <= 0n) {
        throw new Error(
          "Set an entry fee above zero. Every participant stakes it to join, and it comes back to them when they hit the goal - the contract does not allow free-to-join pools.",
        );
      }
      fundingUsdc = parseUsdc(
        initialFunding.trim() === "" ? "0" : initialFunding.trim(),
      );
      if (fundingUsdc < 0n) {
        throw new Error("Initial funding cannot be negative.");
      }
      // Sponsor models (fixed bounty, pot split) need a seed to pay from. A
      // self-staked commitment pool needs no sponsor - achievers are paid from
      // the forfeited stakes - so it may be created with zero initial funding.
      if (bountyModel !== 2 && fundingUsdc <= 0n) {
        throw new Error("Seed the bounty with an initial funding above zero.");
      }
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Check the form values.",
      );
      return;
    }

    // Runs on submit, not during render: the clock read is the point.
    // eslint-disable-next-line react-hooks/purity
    const now = BigInt(Math.floor(Date.now() / 1000));
    const periodStart = now;
    const periodEnd = now + BigInt(durationDays * SECONDS_PER_DAY);

    // Serialize the proof policy into the goalSpec marker. A pure wearable floor
    // stays unmarked and a pure document floor stays "[doc]" (byte-identical to
    // before); only a self-reported floor or opt-in emits a "[proof=...]" marker.
    const accepted: Modality[] =
      floor === "self-reported"
        ? ["self-reported"]
        : acceptSelfReported
          ? [floor, "self-reported"]
          : [floor];
    const encodedGoalSpec = withProofPolicy(goalSpec.trim(), {
      floor,
      accepted,
    });

    // Backstop on the shared dead-config predicate. The fee validation above
    // already rejects a zero entry fee for every model, but the assertion is
    // what keeps this airtight if that validation ever regresses - the
    // deployed contract would revert DEAD_CONFIG on the same condition.
    if (isEconomicallyDeadConfig(bountyModel, entryFeeUsdc)) {
      setFormError(
        "Set an entry fee above zero - the contract does not allow free-to-join pools.",
      );
      return;
    }

    try {
      const depositHash = await runUsdcDeposit(fundingUsdc, {
        functionName: "createPool",
        args: [
          initiative.trim(),
          encodedGoalSpec,
          entryFeeUsdc,
          periodStart,
          periodEnd,
          bountyModel,
          fundingUsdc,
        ],
      });

      setRedirecting(true);
      await queryClient.invalidateQueries({ queryKey: ["pools"] });
      const newId = await resolveNewPoolId(depositHash);
      router.push(`/pools/${newId.toString()}`);
    } catch {
      // useUsdcDeposit already captured the error into status; surface there.
      setRedirecting(false);
    }
  };

  const primaryLabel =
    status.kind === "fueling"
      ? "One moment..."
      : status.kind === "approving"
      ? "Approving USDC..."
      : status.kind === "depositing"
        ? "Creating pool..."
        : redirecting
          ? "Opening your pool..."
          : authenticated
            ? fundingIsZero
              ? "Create pool"
              : "Approve funding and create pool"
            : "Sign in to create";

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words font-display text-[2rem] font-extrabold leading-display tracking-display sm:text-[2.5rem]">
            Create a pool
          </h1>
          <p className="mt-2 max-w-xl text-base text-muted">
            Set a goal and a stake. Everyone who joins puts up the same USDC on
            hitting their own goal, and the ones who do split what the ones who
            don&apos;t leave behind. Funding it as a sponsor instead? Seed a
            bounty below and pay achievers from it.
          </p>
          <p className="mt-1 text-sm">
            <Link
              href="/sponsor"
              className="inline-flex min-h-11 items-center font-bold text-accent-deep underline underline-offset-4"
            >
              Put up a prize pot
            </Link>
          </p>
        </div>
        <Spotter pose="point" size="xs" decorative className="sm:hidden" />
        <div className="hidden shrink-0 sm:block">
          <Spotter
            pose="point"
            size="sm"
            line="Pick a goal a wearable can check. I only pay on proof."
            linePlacement="side"
            decorative
          />
        </div>
      </div>

      <div className="space-y-5 rounded-3xl border border-edge bg-surface p-4 sm:p-6">
        <fieldset className="block text-sm font-medium">
          <legend className="font-bold">How the goal is checked</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => setFloor("wearable")}
              aria-pressed={floor === "wearable"}
              className={`${OPTION} ${floor === "wearable" ? OPTION_ON : OPTION_OFF}`}
            >
              <span className="block font-bold">Wearable data</span>
              <span className="mt-1 block text-xs font-normal text-muted">
                Verified from any connected wearable: sleep efficiency, hours of sleep or workouts.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setFloor("document")}
              disabled={!docAvailable}
              aria-disabled={!docAvailable}
              aria-pressed={floor === "document"}
              className={`${OPTION} disabled:cursor-not-allowed disabled:opacity-70 ${floor === "document" ? OPTION_ON : OPTION_OFF}`}
            >
              <span className="block font-bold">Document upload</span>
              <span className="mt-1 block text-xs font-normal text-muted">
                {docAvailable
                  ? "Verified from an uploaded record like a flu shot or lab result."
                  : "Paused while we build the verifier - pick a wearable goal for now."}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setFloor("self-reported")}
              aria-pressed={floor === "self-reported"}
              className={`${OPTION} ${floor === "self-reported" ? "border-warning bg-warning/10 text-foreground" : OPTION_OFF}`}
            >
              <span className="block font-bold">Self-reported</span>
              <span className="mt-1 block text-xs font-normal text-muted">
                A photo or screenshot. Low-trust, still in development. We cannot
                confirm a photo is real, recent, or yours. Use only when you
                accept unverified proof.
              </span>
            </button>
          </div>
          {floor !== "self-reported" ? (
            <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-2xl border border-edge bg-surface-raised p-3">
              <input
                type="checkbox"
                checked={acceptSelfReported}
                onChange={(e) => setAcceptSelfReported(e.target.checked)}
                className="mt-1"
              />
              <span className="text-xs font-normal text-muted">
                Also accept self-reported photos/screenshots (low-trust). Adds a
                second, unverified proof path beside the{" "}
                {floor === "document" ? "document" : "wearable"} one. Verified
                claims stay verified; self-reported ones are labeled as such and
                pay at 1x only.
              </span>
            </label>
          ) : null}
        </fieldset>

        {floor === "document" ? (
          <div className="block text-sm font-medium">
            Preventive-care templates
            <div className="mt-2 flex flex-wrap gap-2">
              {DOC_TEMPLATES.map((template) => (
                <button
                  key={template.key}
                  type="button"
                  onClick={() => applyTemplate(template)}
                  disabled={!docAvailable}
                  className={`inline-flex min-h-11 items-center rounded-full border-2 border-edge bg-surface px-4 py-2 text-sm font-bold text-foreground hover:border-foreground/40 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
                >
                  {template.label}
                </button>
              ))}
            </div>
            <span className="mt-1 block text-xs font-normal text-muted">
              One tap prefills the goal, entry fee, and a suggested bounty. You
              can edit anything before creating.
            </span>
          </div>
        ) : null}

        <label className="block text-sm font-medium">
          Initiative
          <input
            type="text"
            placeholder="sleep"
            value={initiative}
            onChange={(e) => setInitiative(e.target.value)}
            className={FIELD}
          />
          <span className="mt-1 block text-xs text-muted">
            Short tag shown on the pool, for example sleep or workouts.
          </span>
        </label>

        <label className="block text-sm font-medium">
          Goal
          {floor === "wearable" ? (
            <span className="mt-1 flex flex-wrap gap-2">
              {LAUNCH_GOAL_EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setGoalSpec(example)}
                  className={`inline-flex min-h-11 items-center rounded-full border border-edge bg-surface-raised px-3 py-1 text-left text-sm font-normal text-foreground hover:border-foreground/40 ${FOCUS_RING}`}
                >
                  {example}
                </button>
              ))}
            </span>
          ) : null}
          <textarea
            placeholder={
              floor === "document"
                ? "Get your annual flu shot and upload your vaccination record."
                : floor === "self-reported"
                  ? "Post a gym selfie every day for a week."
                  : "Sleep at least 7 hours every night for the period."
            }
            value={goalSpec}
            onChange={(e) => setGoalSpec(e.target.value)}
            rows={3}
            className={FIELD}
          />
          {floor === "wearable" ? (
            <>
              {goalNotice.kind === "launch-issue" ? (
                <span className="mt-1 block text-xs text-warning">{goalNotice.text}</span>
              ) : goalNotice.kind === "device-check" ? (
                <AuthorCapabilityNotice goalSpec={goalSpec} noun="pool" />
              ) : null}
              <span className="mt-1 block text-xs text-muted">{COMING_LINE}</span>
            </>
          ) : null}
          <span className="mt-1 block text-xs text-muted">
            {floor === "document"
              ? "Describe what participants must upload. Saved as a document goal so the right verifier and badge are used."
              : floor === "self-reported"
                ? "Describe the photo or screenshot participants must post. Saved as a self-reported goal - low-trust and never marked verified."
                : "The human-readable goal participants commit to."}
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Entry fee (USDC)
            <input
              type="text"
              inputMode="decimal"
              placeholder="5.00"
              value={entryFee}
              onChange={(e) => setEntryFee(e.target.value)}
              className={FIELD}
            />
            <span className="mt-1 block text-xs text-muted">
              What each participant stakes to join. It comes back to them when
              they hit the goal.
            </span>
            {bountyModel === 2 && entryFeeParsed !== null && entryFeeParsed > 0n ? (
              <span className="mt-1.5 block font-normal">
                <CommitmentRangeLine
                  entryFee={entryFeeParsed}
                  sponsorPot={fundingParsed}
                />
              </span>
            ) : null}
            {feeIsZero ? (
              <span className="mt-1 block text-xs font-normal text-warning">
                Must be above zero - the contract does not allow free-to-join
                pools, so every winner is someone who staked.
              </span>
            ) : null}
          </label>

          <label className="block text-sm font-medium">
            Initial funding (USDC)
            <input
              type="text"
              inputMode="decimal"
              placeholder="100.00"
              value={initialFunding}
              onChange={(e) => setInitialFunding(e.target.value)}
              className={FIELD}
            />
            <span className="mt-1 block text-xs text-muted">
              USDC you seed the bounty with now. Pulled from your wallet.
            </span>
          </label>
        </div>

        <div className="block text-sm font-medium">
          Duration
          <div className="mt-2 flex flex-wrap gap-2">
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
          <span className="mt-1 block text-xs text-muted">
            Starts now, ends after the selected duration.
          </span>
        </div>

        <fieldset className="block text-sm font-medium">
          <legend className="font-bold">Payout model</legend>
          <div className="mt-2 space-y-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-edge bg-surface-raised p-3 has-[:checked]:border-foreground has-[:checked]:bg-surface">
              <input
                type="radio"
                name="bountyModel"
                checked={bountyModel === 0}
                onChange={() => setBountyModel(0)}
                className="mt-1"
              />
              <span>
                <span className="block font-bold">
                  Fixed bounty per achiever
                </span>
                <span className="block text-xs font-normal text-muted">
                  Each verified achiever receives the same fixed payout, a
                  multiple of the entry fee.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-edge bg-surface-raised p-3 has-[:checked]:border-foreground has-[:checked]:bg-surface">
              <input
                type="radio"
                name="bountyModel"
                checked={bountyModel === 1}
                onChange={() => setBountyModel(1)}
                className="mt-1"
              />
              <span>
                <span className="block font-bold">Split the pot pro-rata</span>
                <span className="block text-xs font-normal text-muted">
                  The whole pot is shared across achievers in proportion to
                  their results.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-edge bg-surface-raised p-3 has-[:checked]:border-foreground has-[:checked]:bg-surface">
              <input
                type="radio"
                name="bountyModel"
                checked={bountyModel === 2}
                onChange={() => setBountyModel(2)}
                className="mt-1"
              />
              <span>
                <span className="block font-bold">
                  Self-staked commitment
                </span>
                <span className="block text-xs font-normal text-muted">
                  Everyone stakes the same entry fee on their own goal. Hit it
                  and your stake comes back plus a cut of what the ones who
                  didn&apos;t forfeit. No sponsor needed - initial funding can be
                  zero.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <SignInGate note="Sign in to create this pool.">
          {(openSignIn) => (
            <Button
              type="button"
              disabled={!ready || busy || redirecting}
              onClick={() => {
                if (!authenticated) {
                  openSignIn();
                  return;
                }
                void submit();
              }}
              className="w-full"
            >
              {primaryLabel}
            </Button>
          )}
        </SignInGate>

        {authenticated ? <GaslessBadge status={gasless} /> : null}

        {status.kind === "approving" || status.kind === "depositing" ? (
          <div
            aria-live="polite"
            className="flex items-center gap-3 rounded-2xl border border-edge bg-surface-raised p-3 text-sm"
          >
            <Spotter state="loading" size="inline" decorative />
            <p className="font-medium">
              Step {status.kind === "approving" ? "1" : "2"} of 2:{" "}
              {status.kind === "approving"
                ? "approving USDC for the pool"
                : "creating the pool on Base"}
            </p>
          </div>
        ) : null}

        {status.kind === "done" ? (
          <div
            aria-live="polite"
            className="flex items-start gap-3 rounded-2xl border border-edge bg-surface-raised p-3"
          >
            <Spotter pose="thumbsup" size="inline" decorative />
            <div className="min-w-0 space-y-1">
            <p className="text-sm font-bold text-foreground">
              Pool created on Base Sepolia. Opening it now.
            </p>
            {status.approveHash ? (
              <>
                <ArcTxLink
                  txHash={status.approveHash}
                  label="View approval tx"
                />
                <br />
              </>
            ) : null}
            <ArcTxLink
              txHash={status.depositHash}
              label="View createPool tx"
            />
            </div>
          </div>
        ) : null}

        {formError !== null ? (
          <ErrorNote
            title="Check the form"
            detail={formError}
            onRetry={() => setFormError(null)}
          />
        ) : null}

        {status.kind === "error" ? (
          <ErrorNote
            title="Could not create the pool"
            detail={status.message}
            raw={status.raw}
            onRetry={reset}
          />
        ) : null}
      </div>
    </div>
  );
}

export default function CreatePool() {
  if (!DYNAMIC_CONFIGURED) {
    return (
      <EmptyState
        pose="lounging"
        line="Nobody can sign in, so nobody can stake. I'm on break."
        title="Sign-in is off on this build"
        detail="Starting a run needs sign-in, which is not switched on for this build yet. Nothing is wrong on your side."
        action={
          <Link href="/pools" className="inline-flex min-h-12 items-center justify-center rounded-[18px] bg-accent px-5 py-3 text-base font-bold text-foreground shadow-[var(--shadow-pop)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2">
            Go to the lobby
          </Link>
        }
      />
    );
  }
  return <CreatePoolInner />;
}
