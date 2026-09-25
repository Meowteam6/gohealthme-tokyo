"use client";

// One card in the sponsor console: a pool the sponsor funds, its capital, and
// its privacy-safe outcomes. The warm-light "gold" reskin is presentation only;
// the two rules below still shape everything on it:
//
//   1. k-anonymity floor (lib/sponsor-metrics): no outcome derived from fewer
//      than five participants is rendered. A withheld figure shows a designed
//      "held back" state, never a zero that reads as "nobody did it".
//   2. No participant identity, ever: this card renders the pool's own health
//      label (initiative + goal) but NEVER a participant wallet or handle beside
//      it, and never a per-participant metric. The only addresses in the source
//      data were counted and discarded upstream.
//
// LEGAL-GATED, intentionally absent from the copy below: no insurer /
// UnitedHealth "pays for behavior -> fewer claims" ROI reading, and no HIPAA /
// covered-entity language. Those reframes change the product's regulatory
// posture and are held for legal review, not shipped in console copy.

import { useState, type ReactNode } from "react";
import Countdown from "@/components/Countdown";
import FundPool from "@/components/FundPool";
import { Icon } from "@/components/SponsorIcons";
import { Badge, Button, Money } from "@/components/ui";
import {
  displayGoalSpec,
  evidenceTypeOf,
  formatUsdc,
  type PoolInfo,
} from "@/lib/contract";
import { poolIsOver, poolPhase } from "@/lib/pool-lifecycle";
import SweepLeftover from "@/components/SweepLeftover";
import { useEmbeddedWallet } from "@/lib/wallet";
import { poolOutcomeDisplay, type PoolAggregate } from "@/lib/sponsor-metrics";

// The verdict-privacy line. Completion rate is a verdict-derived figure, so any
// card that can show outcomes carries this, matching every other verdict
// surface in the app.
const PRIVACY_LINE =
  "Only the pass or fail verdict leaves SPOTTER's check. Nobody's health data reaches the chain or this console.";

// A tan-well mini stat. `paid` marks the money-in-motion figure (achiever
// payouts) with a leading plus. Every dollar renders through Money — monospace,
// no adjective, and no gold on a static figure: gold is reserved for money in
// motion, which this cumulative total is not.
function WellStat({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted">{label}</p>
      <p className="mt-0.5 font-display text-base font-extrabold leading-tight">
        {children}
      </p>
    </div>
  );
}

export default function SponsorPoolOutcome({
  pool,
  aggregate,
  nowSeconds,
  outcomesOk = true,
}: {
  pool: PoolInfo;
  aggregate: PoolAggregate;
  nowSeconds: bigint;
  /** False when the outcome scan failed: every event-derived figure is then
   *  unknown and says so, instead of rendering as zero or held. */
  outcomesOk?: boolean;
}) {
  const [showTopUp, setShowTopUp] = useState(false);
  const { address } = useEmbeddedWallet();
  const d = poolOutcomeDisplay(aggregate);
  const phase = poolPhase(pool, nowSeconds);
  const isDocGoal = evidenceTypeOf(pool.goalSpec) === "document";

  return (
    <article className="flex flex-col gap-4 rounded-3xl border-2 border-edge bg-surface p-5 shadow-[var(--shadow-pop-edge)] sm:p-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge>{pool.initiative}</Badge>
            <Badge tone={isDocGoal ? "accent" : "muted"}>
              {isDocGoal ? "Document" : "Wearable"}
            </Badge>
          </div>
          {phase === "cancelled" ? (
            <Badge tone="warning">Cancelled</Badge>
          ) : phase === "settled" ? (
            <Badge tone="muted">Settled</Badge>
          ) : phase === "expired" ? (
            <Badge tone="warning">Awaiting settlement</Badge>
          ) : (
            <Badge tone="accent">Open</Badge>
          )}
        </div>
        {/* Health label with no wallet or handle beside it, by rule. */}
        <h3 className="font-display text-lg font-bold leading-snug sm:text-xl">
          {displayGoalSpec(pool.goalSpec)}
        </h3>
        <p className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
          <Icon name="clock" className="h-4 w-4" />
          <Countdown periodStart={pool.periodStart} periodEnd={pool.periodEnd} />
        </p>
      </header>

      {/* Sponsor capital: always shown, never gated. This is the sponsor's own
          money movement, not a participant-derived figure. */}
      <div className="grid grid-cols-2 gap-3 rounded-2xl bg-secondary/60 p-4">
        <WellStat label="In the pool now">
          <Money usd={formatUsdc(d.balanceUsdc)} />
        </WellStat>
        {/* Top-ups only (the create-time seed emits no PoolFunded), from any
            funder. Named for what it is. */}
        <WellStat label="Top-ups, any funder">
          {outcomesOk ? <Money usd={formatUsdc(d.toppedUpUsdc)} /> : (
            <span className="text-muted">Unknown</span>
          )}
        </WellStat>
      </div>

      {/* Outcomes: gated by the k-anonymity floor, and blanked (not zeroed)
          when the scan could not be read. */}
      {!outcomesOk ? (
        <p
          role="status"
          className="rounded-2xl border border-dashed border-warning/40 bg-surface-raised p-4 text-sm text-muted"
        >
          Joins, completions and payouts for this pool could not be read right
          now. The balance above is live.
        </p>
      ) : d.belowFloor ? (
        <div className="rounded-2xl border border-dashed border-edge bg-surface-raised p-4">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <Icon name="eyeOff" className="h-4 w-4 text-muted" />
            Outcomes are hidden here
          </p>
          <p className="mt-1 text-sm text-muted">
            This pool has fewer than five participants, so no completion or
            payout figure is shown. Outcomes appear once at least five people
            have joined. No participant is ever named.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 rounded-2xl bg-secondary/60 p-4">
            <WellStat label="Joined">{d.joined ?? 0}</WellStat>
            <WellStat label="Completion rate">
              {d.completionRatePct !== null ? `${d.completionRatePct}%` : "—"}
            </WellStat>
          </div>

          {d.completions !== null && d.paidUsdc !== null ? (
            <div className="grid grid-cols-2 gap-3 rounded-2xl bg-secondary/60 p-4">
              <WellStat label="Paid to achievers">
                <Money usd={formatUsdc(d.paidUsdc)} sign="+" />
              </WellStat>
              <WellStat label="Cost per completion">
                {d.costPerCompletionUsdc !== null ? (
                  <Money usd={formatUsdc(d.costPerCompletionUsdc)} />
                ) : (
                  "—"
                )}
              </WellStat>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-edge bg-surface-raised p-3 text-sm text-muted">
              Payout figures unlock once five participants have been verified.
              Fewer than that and the amount could point at one person, so it
              stays held.
            </p>
          )}

          <p className="inline-flex items-start gap-1.5 text-xs leading-relaxed text-muted">
            <Icon name="shield" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {PRIVACY_LINE}
          </p>
        </div>
      )}

      {/* Top up: the existing FundPool machinery, reused unchanged. Only offered
          while the pool can still take funds — the contract reverts fundPool on
          a settled pool. */}
      {/* A finished pool's leftover goes back to its creator through sweep();
          the card owns every state, including the cancelled pool that waits
          on its players' refunds. */}
      {poolIsOver(phase) ? (
        <div className="border-t border-edge pt-4">
          <SweepLeftover pool={pool} phase={phase} address={address} />
        </div>
      ) : null}

      {!poolIsOver(phase) ? (
        <div className="border-t border-edge pt-4">
          {showTopUp ? (
            <FundPool poolId={pool.id} />
          ) : (
            <Button
              variant="primary"
              pop
              onClick={() => setShowTopUp(true)}
              className="w-full"
            >
              <Icon name="plus" className="h-4 w-4" />
              Top up this pool
            </Button>
          )}
        </div>
      ) : null}
    </article>
  );
}
