"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createCommitmentCopy } from "@/lib/commitment-copy";
import { missRuleWouldApply } from "@/lib/miss-rule";
import { useQueryClient } from "@tanstack/react-query";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import {
  getHealthPoolsAddress,
  parseUsdc,
  withProofPolicy,
  type Modality,
} from "@/lib/contract";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useDisplayNames } from "@/lib/use-display-names";
import { useDocumentProofAvailable } from "@/lib/useProofStatus";
import AuthorCapabilityNotice from "@/components/AuthorCapabilityNotice";
import { launchGoalIssue, LAUNCH_GOAL_EXAMPLES, wearableGoalNotice } from "@/lib/launch-goal-check";
import { COMING_LINE } from "@/lib/provider-capabilities";
import { useUsdcDeposit } from "@/lib/useUsdcDeposit";
import { isEconomicallyDeadConfig } from "@/lib/pool-lifecycle";
import { resolveNewPoolId } from "@/lib/resolve-pool-id";
import { ArcTxLink, Button, Card, Chip, ErrorNote, Fine, buttonClasses } from "@/components/ui";
import { CommitmentRangeLine } from "@/components/CommitmentTerms";
import { MoneyChips, MoneyTermsList } from "@/components/game/MoneyTerms";
import { runMoneyOf, type RunMoney } from "@/lib/game/money-flow";
import {
  EmptyCard,
  FIELD,
  FIELD_HINT,
  FIELD_LABEL,
  Notice,
  OptionMark,
  PAGE_COLUMN,
  PerchedHeader,
  QUIET_ACTION,
  optionCard,
} from "@/components/night/kit";
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

function CreatePoolInner({ embedded }: { embedded: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ready, authenticated, address } = useEmbeddedWallet();
  // The sponsor's name as players will read it on the run.
  const { displayName } = useDisplayNames(address !== null ? [address] : []);
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
      <RunsOff
        title="Runs are off on this build"
        detail="Starting a run is not switched on for this build yet. Nothing is wrong on your side."
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
        throw new Error("Enter a tag, for example \"sleep\".");
      }
      if (goalSpec.trim() === "") {
        throw new Error("Describe the goal players must hit.");
      }
      if (floor === "wearable") {
        // Only goals every supported wearable can verify (lib/provider-capabilities).
        const issue = launchGoalIssue(goalSpec);
        if (issue !== null) throw new Error(issue);
      }
      entryFeeUsdc = parseUsdc(entryFee.trim() === "" ? "0" : entryFee.trim());
      // The deployed contract reverts DEAD_CONFIG on a zero entry fee for
      // every payout model (every winner must have staked), so catch it here
      // with a plain message instead of sending a doomed transaction.
      if (entryFeeUsdc <= 0n) {
        throw new Error(
          "Set an entry fee above zero. Every player stakes it to join, and it comes back to them when they hit the goal. The contract does not allow free-to-join runs.",
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
        "Set an entry fee above zero. The contract does not allow free-to-join runs.",
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
      ? "One moment"
      : status.kind === "approving"
      ? "Approving USDC"
      : status.kind === "depositing"
        ? "Creating the run"
        : redirecting
          ? "Opening your run"
          : authenticated
            ? fundingIsZero
              ? "Create the run"
              : "Approve funding and create the run"
            : "Sign in to create";

  const floorOptions: { id: Modality; title: string; body: string; disabled?: boolean }[] = [
    {
      id: "wearable",
      title: "Wearable data",
      body: "Checked from any paired wearable: sleep efficiency, hours of sleep or workouts.",
    },
    {
      id: "document",
      title: "Document upload",
      body: docAvailable
        ? "Checked from an uploaded record like a flu shot or lab result."
        : "Paused while the checker is built. Pick a wearable goal for now.",
      disabled: !docAvailable,
    },
    {
      id: "self-reported",
      title: "Self-reported",
      body: "A photo or screenshot. Low trust and still in development: nobody can confirm a photo is real, recent or yours. Use it only when you accept unverified proof.",
    },
  ];

  // The goal as submit will encode it, for the copy that depends on whether
  // the run can record a miss: only a wearable-only sleep or workout goal
  // can (lib/miss-rule.ts). Every other self-staked run refunds a miss.
  const previewAccepted: Modality[] =
    floor === "self-reported"
      ? ["self-reported"]
      : acceptSelfReported
        ? [floor, "self-reported"]
        : [floor];
  const previewGoalSpec = withProofPolicy(goalSpec.trim(), { floor, accepted: previewAccepted });
  const recordsMisses = missRuleWouldApply({ bountyModel: 2, goalSpec: previewGoalSpec });

  // Each model is a money flow (docs/MONEY-FLOWS.md): models 0 and 1 are a
  // sponsored run, model 2 a group run. The chips and the selected model's
  // terms show here, before any USDC is approved, in the numbers typed so far.
  const moneyOf = (model: number): RunMoney =>
    runMoneyOf({
      pool: { bountyModel: model, initiative: "" },
      // Worded as players will read it on the run: signed in, by your name.
      flow: {
        players: 0,
        creatorStaked: null,
        creatorName: address !== null ? displayName(address) : "you",
        viewerIsCreator: address === null,
      },
      numbers: {
        entryFee: entryFeeParsed ?? 0n,
        players: 0,
        pot: fundingParsed,
        // Nobody is in yet, so no miss is shared and no fee can apply.
        feeBps: 0,
        recordable: model === 2 && recordsMisses,
        includeJoiner: true,
        confirmBy: null,
      },
    });
  const selectedMoney = entryFeeParsed !== null && entryFeeParsed > 0n ? moneyOf(bountyModel) : null;

  const payoutOptions: { id: number; title: string; body: string }[] = [
    {
      id: 0,
      title: "Fixed bounty per player who hits",
      body: "Each player who hits gets their stake times a multiplier, paid from your pot. A short pot scales every payout down, so a hit can pay less than the stake. A miss gets the stake back.",
    },
    {
      id: 1,
      title: "Split the pot pro-rata",
      body: "The whole pot is shared across the players who hit, weighted by result, so a share can be less than the stake. A miss gets the stake back.",
    },
    {
      id: 2,
      title: "Self-staked commitment",
      body: createCommitmentCopy(previewGoalSpec),
    },
  ];

  const form = (
        <Card className="[&>*+*]:mt-6">
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className={SECTION_LABEL}>How the goal is checked</legend>
            <div role="radiogroup" aria-label="How the goal is checked" className="mt-3 grid gap-2.5 sm:grid-cols-3">
              {floorOptions.map((opt) => {
                const selected = floor === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={opt.disabled === true}
                    onClick={() => setFloor(opt.id)}
                    className={`${optionCard(selected, opt.disabled === true)} flex flex-col gap-1.5`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[0.9375rem] font-semibold leading-tight">{opt.title}</span>
                      <OptionMark selected={selected} />
                    </span>
                    <span className="text-[0.8125rem] leading-[1.45] text-haze">{opt.body}</span>
                  </button>
                );
              })}
            </div>
            {floor !== "self-reported" ? (
              <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-control bg-fill-quiet p-3.5 shadow-[inset_0_0_0_1px_var(--border)]">
                <input
                  type="checkbox"
                  checked={acceptSelfReported}
                  onChange={(e) => setAcceptSelfReported(e.target.checked)}
                  className="mt-0.5 size-5 flex-none accent-foreground"
                />
                <span className="text-[0.8125rem] leading-[1.45] text-muted">
                  Also accept self-reported photos or screenshots (low trust). Adds a
                  second, unverified proof path beside the{" "}
                  {floor === "document" ? "document" : "wearable"} one. Verified claims
                  stay verified; self-reported ones are labeled as such and pay at 1x
                  only.
                </span>
              </label>
            ) : null}
          </fieldset>

          {floor === "document" ? (
            <div className="[&>*+*]:mt-3 border-t border-edge pt-5">
              <h2 className={SECTION_LABEL}>Preventive-care templates</h2>
              <div className="flex flex-wrap gap-2">
                {DOC_TEMPLATES.map((template) => (
                  <Chip
                    key={template.key}
                    onClick={() => applyTemplate(template)}
                    disabled={!docAvailable}
                  >
                    {template.label}
                  </Chip>
                ))}
              </div>
              <p className={FIELD_HINT}>
                One tap fills in the goal, entry fee and a suggested bounty. You can
                edit anything before creating.
              </p>
            </div>
          ) : null}

          <div className="border-t border-edge pt-5">
            <label htmlFor="pool-initiative" className={FIELD_LABEL}>
              Tag
            </label>
            <input
              id="pool-initiative"
              type="text"
              placeholder="sleep"
              value={initiative}
              onChange={(e) => setInitiative(e.target.value)}
              className={FIELD}
            />
            <p className={FIELD_HINT}>A short tag shown on the run, for example sleep or workouts.</p>
          </div>

          <div className="[&>*+*]:mt-3">
            <label htmlFor="pool-goal" className={`${FIELD_LABEL} !mb-0`}>
              Goal
            </label>
            {floor === "wearable" ? (
              <div role="group" aria-label="Goals every wearable can check" className="flex flex-wrap gap-2">
                {LAUNCH_GOAL_EXAMPLES.map((example) => (
                  <Chip
                    key={example}
                    selected={goalSpec.trim() === example}
                    onClick={() => setGoalSpec(example)}
                    className="max-w-full whitespace-normal py-2.5 text-left !leading-snug"
                  >
                    {example}
                  </Chip>
                ))}
              </div>
            ) : null}
            <textarea
              id="pool-goal"
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
              className={`${FIELD} resize-y`}
            />
            {floor === "wearable" ? (
              goalNotice.kind === "launch-issue" ? (
                <Notice tone="limit" role="status">
                  {goalNotice.text}
                </Notice>
              ) : goalNotice.kind === "device-check" ? (
                <AuthorCapabilityNotice goalSpec={goalSpec} noun="run" />
              ) : null
            ) : null}
            <p className={`${FIELD_HINT} !mt-0`}>
              {floor === "document"
                ? "Describe what players must upload. Saved as a document goal so the right checker and badge are used."
                : floor === "self-reported"
                  ? "Describe the photo or screenshot players must post. Saved as a self-reported goal: low trust and never marked verified."
                  : `The goal players commit to. ${COMING_LINE}`}
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="pool-fee" className={FIELD_LABEL}>
                Entry fee
              </label>
              <div className="relative">
                <input
                  id="pool-fee"
                  type="text"
                  inputMode="decimal"
                  placeholder="5.00"
                  value={entryFee}
                  aria-invalid={feeIsZero && entryFee.trim() !== ""}
                  onChange={(e) => setEntryFee(e.target.value)}
                  className={`${FIELD} num pr-16`}
                />
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[0.9375rem] text-haze">
                  USDC
                </span>
              </div>
              <p className={FIELD_HINT}>
                {bountyModel === 2
                  ? "What each player stakes to join. It comes back to them when they hit the goal."
                  : "What each player stakes to join. A miss gets it back; a hit pays by the model below, which can be less than the stake."}
              </p>
              {bountyModel === 2 && entryFeeParsed !== null && entryFeeParsed > 0n ? (
                <div className="mt-2">
                  <CommitmentRangeLine
                    entryFee={entryFeeParsed}
                    sponsorPot={fundingParsed}
                    recordsMisses={recordsMisses}
                  />
                </div>
              ) : null}
              {/* Said once they have typed a zero, not on an empty field. */}
              {feeIsZero && entryFee.trim() !== "" ? (
                <p className="m-0 mt-2 text-[0.8125rem] leading-[1.45] text-danger">
                  Must be above zero. The contract does not allow free-to-join runs, so
                  every player who hits is someone who staked.
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="pool-funding" className={FIELD_LABEL}>
                Initial funding
              </label>
              <div className="relative">
                <input
                  id="pool-funding"
                  type="text"
                  inputMode="decimal"
                  placeholder="100.00"
                  value={initialFunding}
                  onChange={(e) => setInitialFunding(e.target.value)}
                  className={`${FIELD} num pr-16`}
                />
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[0.9375rem] text-haze">
                  USDC
                </span>
              </div>
              <p className={FIELD_HINT}>USDC you seed the bounty with now. Pulled from your wallet.</p>
            </div>
          </div>

          <div className="[&>*+*]:mt-3 border-t border-edge pt-5">
            <h2 className={SECTION_LABEL}>How long it runs</h2>
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
            <p className={FIELD_HINT}>Starts now and ends after the chosen length.</p>
          </div>

          <fieldset className="m-0 min-w-0 border-0 border-t border-edge p-0 pt-5">
            <legend className={`${SECTION_LABEL} float-left mb-3 w-full`}>How it pays</legend>
            <div className="clear-left [&>*+*]:mt-2.5">
              {payoutOptions.map((opt) => {
                const selected = bountyModel === opt.id;
                const optMoney = moneyOf(opt.id);
                return (
                  <label
                    key={opt.id}
                    className={`${optionCard(selected)} flex cursor-pointer items-start gap-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-foreground`}
                  >
                    <input
                      type="radio"
                      name="bountyModel"
                      checked={selected}
                      onChange={() => setBountyModel(opt.id)}
                      className="sr-only"
                    />
                    <span className="mt-0.5">
                      <OptionMark selected={selected} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[0.9375rem] font-semibold leading-tight">{opt.title}</span>
                      <MoneyChips
                        kind={optMoney.kind.chip}
                        miss={optMoney.miss}
                        inline
                        className="mt-2"
                      />
                      <span className="mt-2 block text-[0.8125rem] leading-[1.45] text-haze">{opt.body}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {selectedMoney !== null && selectedMoney.copy !== null ? (
              <div
                aria-live="polite"
                className="mt-4 rounded-control bg-surface-raised p-4 shadow-[inset_0_0_0_1px_var(--border)]"
              >
                <p className="m-0 mb-2.5 text-[0.8125rem] font-semibold text-haze">What players read before they stake</p>
                <MoneyTermsList copy={selectedMoney.copy} id="create-pool-terms" />
              </div>
            ) : (
              <p className={FIELD_HINT}>Set an entry fee above zero to see the terms players get.</p>
            )}
          </fieldset>

          <div className="[&>*+*]:mt-3 border-t border-edge pt-5">
            <SignInGate note="Sign in to create this run.">
              {(openSignIn) => (
                <Button
                  type="button"
                  block
                  aria-busy={busy || redirecting}
                  disabled={!ready || busy || redirecting}
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
            <Fine className="text-center">Test USDC on Base Sepolia during beta.</Fine>

            {authenticated ? <GaslessBadge status={gasless} /> : null}

            <div aria-live="polite" className="[&>*+*]:mt-3">
              {status.kind === "approving" || status.kind === "depositing" ? (
                <Notice tone="info">
                  Step {status.kind === "approving" ? "1" : "2"} of 2:{" "}
                  {status.kind === "approving"
                    ? "approving USDC for the run"
                    : "creating the run on Base"}
                </Notice>
              ) : null}

              {status.kind === "done" ? (
                <Notice tone="ok" title="Run created on Base Sepolia. Opening it now.">
                  {status.approveHash ? (
                    <ArcTxLink txHash={status.approveHash} label="View the approval tx" />
                  ) : null}
                  <ArcTxLink txHash={status.depositHash} label="View the create tx" />
                </Notice>
              ) : null}
            </div>

            {formError !== null ? (
              <ErrorNote
                title="Check the form"
                detail={formError}
                retryLabel="Edit the run"
                onRetry={() => setFormError(null)}
              />
            ) : null}

            {status.kind === "error" ? (
              <ErrorNote
                title="Could not create the run"
                detail={status.message}
                raw={status.raw}
                retryLabel="Try again"
                onRetry={reset}
              />
            ) : null}
          </div>
        </Card>
  );

  // Inside the sponsor console the form is one card among others: no second
  // page title and no second pose.
  if (embedded) return form;
  return (
    <div className={PAGE_COLUMN}>
      <PerchedHeader
        title="Start a run"
        lead="Set a goal and a stake. Everyone who joins puts up the same USDC on their own goal, and the players who hit it split what the misses leave behind."
        pose="wearable"
        below={
          <Link href="/sponsor" className={`${QUIET_ACTION} mt-2`}>
            Put up a prize pot instead
          </Link>
        }
      >
        {form}
      </PerchedHeader>
    </div>
  );
}

const SECTION_LABEL = "m-0 block p-0 text-[1.0625rem] font-semibold leading-tight text-foreground";

/** Starting a run is off on this build: said plainly, with the way back. */
function RunsOff({ title, detail }: { title: string; detail: string }) {
  return (
    <div className={PAGE_COLUMN}>
      <PerchedHeader title="Start a run" pose="meditate">
        <EmptyCard
          title={title}
          detail={detail}
          action={
            <Link href="/pools" className={buttonClasses({ size: "sm" })}>
              See the open runs
            </Link>
          }
        />
      </PerchedHeader>
    </div>
  );
}

export default function CreatePool({ embedded = false }: { embedded?: boolean } = {}) {
  if (!DYNAMIC_CONFIGURED) {
    return (
      <RunsOff
        title="Sign-in is off on this build"
        detail="Starting a run needs sign-in, which is not switched on for this build yet. Nothing is wrong on your side."
      />
    );
  }
  return <CreatePoolInner embedded={embedded} />;
}
