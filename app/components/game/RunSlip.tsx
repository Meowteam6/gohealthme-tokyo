"use client";

// One run in the lobby, as a row (docs/DESIGN.md): the goal, time left and
// status on the left, stake to pot in gold on the right. A lock shows inline
// with SPOTTER's detective, the reason and the fix, before any stake. The row
// head links to the run page; the fix sits outside that link so the two are
// never nested.

import Link from "next/link";
import type { ReactNode } from "react";
import { displayGoalSpec, formatUsdc } from "@/lib/contract";
import { formatRunClock, runClock } from "@/lib/game/tally";
import { useNowSeconds } from "@/lib/game/useNowSeconds";
import type { LobbyRow } from "@/lib/game/lobby";
import { closedRunTag } from "@/lib/game/run-end";
import LockPanel from "@/components/game/LockPanel";
import Spotter from "@/components/spotter/Spotter";
import { Skeleton } from "@/components/ui";

function StateTag({ row }: { row: LobbyRow }) {
  const slot = row.slot;
  const tone =
    slot.kind === "playable"
      ? "border-foreground text-foreground"
      : slot.kind === "in-run"
        ? "border-foreground bg-foreground text-background"
        : slot.kind === "locked"
          ? "border-warning/50 text-warning"
          : "border-edge text-muted";
  const label =
    slot.kind === "playable"
      ? slot.proof === "upload"
        ? "Playable by upload"
        : "Playable"
      : slot.kind === "in-run"
        ? "You are in"
        : slot.kind === "locked"
          ? slot.lock.kind === "sign-in"
            ? "Sign in to play"
            : slot.lock.kind === "verifier-off" || slot.lock.kind === "payouts-paused"
              ? "Paused"
              : "Locked for you"
          : slot.kind === "checking"
            ? "Checking"
            : slot.kind === "closed"
            ? closedRunTag(row.phase)
            : "Cannot pay";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border-2 px-2.5 py-0.5 text-xs font-bold ${tone}`}
    >
      {label}
    </span>
  );
}

function RowHead({ href, children }: { href: string | null; children: ReactNode }) {
  if (href === null) return <div className="p-4">{children}</div>;
  return (
    <Link
      href={href}
      className="block rounded-[20px] p-4 hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground"
    >
      {children}
    </Link>
  );
}

export default function RunSlip({
  row,
  returnTo,
  action,
  onRetry,
  onCheckSensor,
}: {
  row: LobbyRow;
  returnTo: string;
  /** The run's own entry control, rendered in the row instead of a link to
   *  the run page (the challenge link: a private dare's page is closed to
   *  anyone not yet in it, so entering happens here). Hidden while the row
   *  is locked or checking. */
  action?: ReactNode;
  /** Re-reads a failed join check ("Check again"). */
  onRetry?: () => void;
  /** The one-tap sensor check, for a locked highlighted row. */
  onCheckSensor?: () => Promise<boolean>;
}) {
  const now = useNowSeconds();
  const { pool } = row;
  const href = `/pools/${pool.id.toString()}`;
  const clock = now === null ? null : runClock(pool.periodStart, pool.periodEnd, now);
  const selfStaked = pool.bountyModel === 2;
  const locked = row.slot.kind === "locked";
  const stake = formatUsdc(pool.entryFee);
  const pot = formatUsdc(pool.balance);
  const timeLeft =
    clock === null ? "--" : clock.ended ? "Ended" : `${formatRunClock(clock)} left`;

  return (
    <article
      className={`rounded-[20px] border ${
        row.highlighted ? "border-2 border-foreground" : "border-edge"
      } ${locked ? "bg-surface-raised" : "bg-surface"}`}
    >
      <RowHead href={action === undefined ? href : null}>
        {row.highlighted ? (
          <p className="mb-1.5 text-sm font-bold text-accent-deep">You were dared into this run</p>
        ) : null}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1">
          <h3 className="min-w-0 break-words text-base font-bold leading-snug">
            {displayGoalSpec(pool.goalSpec)}
          </h3>
          <p
            className="max-w-[45vw] text-right font-display sm:max-w-none text-[1.375rem] font-extrabold leading-none tracking-display tabular-nums text-gold-deep"
            aria-label={`${selfStaked ? "Stake" : "Entry"} ${stake} USDC, pot ${pot} USDC`}
          >
            <span aria-hidden="true">
              {stake} <span className="font-sans text-base font-bold">to</span> {pot}
            </span>
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span className="tabular-nums">{timeLeft}</span>
            <StateTag row={row} />
          </div>
          <p className="text-right text-xs text-muted">test USDC</p>
        </div>
      </RowHead>
      {action !== undefined ? (
        // A locked or still-checking run never shows its entry control, even
        // one that decides its own locks: the row's lock is shown instead, so
        // the stake cannot appear on a board that says "locked".
        <div className="px-4 pb-4">
          {row.slot.kind === "locked" ? (
            <LockPanel
              lock={row.slot.lock}
              returnTo={returnTo}
              onRetry={onRetry}
              onCheckSensor={onCheckSensor}
            />
          ) : row.slot.kind === "checking" ? (
            <Skeleton className="h-12 w-full rounded-[18px]" />
          ) : (
            action
          )}
        </div>
      ) : null}
      {action === undefined &&
      row.slot.kind === "locked" &&
      row.slot.lock.kind !== "sensor-unchecked" &&
      row.slot.lock.kind !== "sign-in" ? (
        <div className="px-4 pb-4">
          <LockPanel
            lock={row.slot.lock}
            returnTo={returnTo}
            onRetry={onRetry}
            onCheckSensor={onCheckSensor}
            compact
          />
        </div>
      ) : null}
      {action === undefined &&
      row.slot.kind === "locked" &&
      row.slot.lock.kind === "sensor-unchecked" ? (
        <div className="flex items-center gap-2 px-4 pb-4">
          <Spotter state="locked-row" size="row" decorative />
          <p className="text-sm text-foreground/85">
            Locked until I check your wearable. The one tap above opens every
            run at once.
          </p>
        </div>
      ) : null}
    </article>
  );
}
