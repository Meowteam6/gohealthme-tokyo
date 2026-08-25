import Link from "next/link";
import Countdown from "@/components/Countdown";
import { Badge, Money, ProofTierBadges } from "@/components/ui";
import {
  displayGoalSpec,
  formatUsdc,
  proofPolicyOf,
  shortAddress,
  type PoolInfo,
} from "@/lib/contract";
import { type PoolPhase } from "@/lib/pool-lifecycle";
import { otterPoseForGoal } from "@/lib/spotter-goal";

// Soft per-action wash behind the otter tile so SPOTTER reads at a glance.
// Activity poses (run/lift/sleep/meditate) fall back to the warm tan every
// candy tile uses, so the tile never looks flat-white against the card.
const OTTER_TINT: Record<string, string> = {
  flushot: "#fdeadf",
  screening: "#e2f4fd",
  dental: "#e4f6ee",
  checkup: "#e4f6ee",
  greet: "#f4efe3",
};

// One SPOTTER-voiced call-to-action per lifecycle phase. The whole card is the
// link to the pool, so this is the affordance, never a nested <button> (a Link
// cannot legally wrap one). Human copy only - no settle()/chain jargon.
const CTA: Record<PoolPhase, string> = {
  live: "Join this pool",
  expired: "See where it stands",
  settled: "See who got paid",
};

function ClockGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ArrowGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4 transition-transform group-hover:translate-x-0.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

// phase is passed by the pool list so one clock snapshot orders and labels every
// card consistently - the card never reads the clock itself.
export default function PoolCard({
  pool,
  phase,
}: {
  pool: PoolInfo;
  phase: PoolPhase;
}) {
  const policy = proofPolicyOf(pool.goalSpec);
  const isPreventiveCare = policy.floor === "document";
  // Model 2 has no sponsor: the creator set the terms and every participant
  // stakes their own USDC, so a "sponsor" attribution would mislead.
  const isSelfStake = pool.bountyModel === 2;
  const noEntryFee = pool.entryFee === 0n;
  // The card's icon slot IS SPOTTER doing the goal's action. Decorative, so the
  // otter is aria-hidden - the goal title already carries the meaning. The
  // shared mascot components only speak fixed poses; the per-goal pose comes
  // from otterPoseForGoal, which only ever returns real /spotter files.
  const pose = otterPoseForGoal(pool.initiative, pool.goalSpec);

  return (
    <Link
      href={`/pools/${pool.id.toString()}`}
      className="group flex flex-col rounded-3xl border-2 border-edge bg-surface p-5 shadow-[var(--shadow-pop-edge)] transition-transform duration-200 hover:-translate-y-1 hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/* header: per-goal SPOTTER + goal title + a human one-liner */}
      <div className="flex items-start gap-3">
        <div
          className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-edge"
          style={{ backgroundColor: OTTER_TINT[pose] ?? "var(--secondary)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/spotter/spotter-${pose}.png`}
            alt=""
            aria-hidden="true"
            className="otter-float size-12 object-contain"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-bold leading-snug text-balance">
            {displayGoalSpec(pool.goalSpec)}
          </h3>
          <p className="mt-1 text-sm leading-snug text-muted text-pretty">
            {isSelfStake
              ? "Back yourself. Hit the goal, get your stake back plus a cut of the forfeits."
              : "A sponsor's funding this one. Hit the goal and SPOTTER pays you the moment it checks out."}
          </p>
        </div>
      </div>

      {/* trust + lifecycle tags. ProofTierBadges is the honest source of truth:
          a self-reported floor reads low-trust here and never "verified". */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Badge>{pool.initiative}</Badge>
        <ProofTierBadges policy={policy} />
        {phase === "settled" ? (
          <Badge tone="muted">Paid out</Badge>
        ) : phase === "expired" ? (
          <Badge tone="warning">Ended</Badge>
        ) : null}
      </div>

      {isPreventiveCare ? (
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-accent-strong">
          Preventive care - the reward is the pool below
        </p>
      ) : null}

      {/* reward + entry, in one candy well. Amounts render through Money (the
          honest-core primitive): a resting balance is never gold - gold is money
          in motion only, and there is no adjective on the figure. */}
      <div className="mt-4 flex items-stretch justify-between gap-3 rounded-2xl bg-secondary/60 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
            Reward pool
          </p>
          <p className="mt-0.5">
            <Money usd={formatUsdc(pool.balance)} size="lg" />
          </p>
        </div>
        <div className="w-px shrink-0 self-stretch bg-edge" />
        <div className="min-w-0 text-right">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
            {isSelfStake ? "Your stake" : "Entry"}
          </p>
          <p className="mt-0.5">
            {noEntryFee ? (
              <span className="font-display text-base font-bold text-accent-strong">
                Free to join
              </span>
            ) : (
              <Money usd={formatUsdc(pool.entryFee)} size="md" />
            )}
          </p>
        </div>
      </div>

      {/* footer meta: time left + who is behind the pool */}
      <div className="mt-3 flex items-center justify-between gap-2 text-xs font-semibold text-muted">
        <span className="inline-flex items-center gap-1.5">
          <ClockGlyph />
          <Countdown periodStart={pool.periodStart} periodEnd={pool.periodEnd} />
        </span>
        <span className="truncate">
          {isSelfStake ? "Self-staked pool" : `Sponsor ${shortAddress(pool.creator)}`}
        </span>
      </div>

      {/* Join affordance - a span styled as the primary candy button, because
          the whole card is already the link into the pool. */}
      <span
        className={`mt-4 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full px-5 py-3 font-display text-base font-bold transition-colors ${
          phase === "live"
            ? "bg-accent text-white shadow-[var(--shadow-pop)] group-hover:bg-accent-strong"
            : "border-2 border-edge bg-secondary text-secondary-foreground group-hover:border-accent/50"
        }`}
      >
        {CTA[phase]}
        <ArrowGlyph />
      </span>
    </Link>
  );
}
