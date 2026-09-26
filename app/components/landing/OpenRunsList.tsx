"use client";

// "Open runs" on the landing: the wearable picker, then every open run as a
// night card whose last line says whether the picked wearable can check it.
// Limits show here, before sign-in and long before any stake.

import Link from "next/link";
import RunRow, { FitLine } from "@/components/game/RunRow";
import WearableChips from "@/components/game/WearableChips";
import { Button, Skeleton, TEXT_LINK } from "@/components/ui";
import { runKind, runName, type OpenRun } from "@/lib/game/landing";
import type { OpenRunsStatus } from "@/lib/game/useOpenRuns";
import { brandFit, brandHint, type WearableAvailability, type WearableBrand } from "@/lib/game/wearable-fit";

export default function OpenRunsList({
  status,
  runs,
  availability,
  picked,
  onPick,
  onRetry,
}: {
  status: OpenRunsStatus;
  runs: readonly OpenRun[];
  availability: WearableAvailability;
  picked: WearableBrand | null;
  onPick: (brand: WearableBrand) => void;
  onRetry?: () => void;
}) {
  const hint =
    picked === null || status !== "ready"
      ? null
      : brandHint(
          picked,
          runs.map((r) => r.pool.goalSpec),
          availability,
        );

  return (
    <>
      <WearableChips picked={picked} onPick={onPick} hint={hint} className="mt-5" />
      {status === "loading" ? (
        <ul className="m-0 mt-3.5 grid list-none gap-2.5 p-0 min-[900px]:grid-cols-3 min-[900px]:gap-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <Skeleton className="h-[118px] rounded-2xl" />
            </li>
          ))}
        </ul>
      ) : status === "error" || status === "not-configured" ? (
        <div className="mt-3.5 rounded-2xl bg-surface px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--border)]" role="alert">
          <p className="m-0 font-semibold">I could not read the runs just now.</p>
          <p className="m-0 mt-1 text-sm text-muted">Nothing changed on your side.</p>
          {status === "error" && onRetry !== undefined ? (
            <Button variant="secondary" size="sm" onClick={onRetry} className="mt-3">
              Read the runs again
            </Button>
          ) : null}
        </div>
      ) : runs.length === 0 ? (
        <div className="mt-3.5 rounded-2xl bg-surface px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--border)]">
          <p className="m-0 font-semibold">No open runs right now.</p>
          <p className="m-0 mt-1 text-sm text-muted">
            Start one and I will read the wearables.{" "}
            <Link href="/pools/create" className={TEXT_LINK}>
              Start a run
            </Link>
          </p>
        </div>
      ) : (
        <ul className="m-0 mt-3.5 grid list-none gap-2.5 p-0 min-[900px]:grid-cols-3 min-[900px]:gap-4">
          {runs.map((run) => {
            const fit = picked === null ? null : brandFit(picked, run.pool.goalSpec, availability);
            return (
              <li key={run.pool.id.toString()}>
                <RunRow
                  href={`/pools/${run.pool.id.toString()}`}
                  name={runName(run.pool)}
                  kind={runKind(run.pool.goalSpec)}
                  periodEnd={run.pool.periodEnd}
                  players={run.players}
                  entryFee={run.pool.entryFee}
                  balance={run.pool.balance}
                  tone={fit !== null && !fit.ok ? "locked" : "default"}
                  fit={fit !== null ? <FitLine ok={fit.ok}>{fit.line}</FitLine> : undefined}
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
