"use client";

// One run in the lobby, as a slip: the goal, stake to prize, time left, and
// its state. A lock shows inline with its fix, before any stake. The whole
// slip links to the run page; the fix link sits outside that link so the two
// are never nested.

import Link from "next/link";
import type { ReactNode } from "react";
import { displayGoalSpec, formatUsdc } from "@/lib/contract";
import { formatRunClock, runClock } from "@/lib/game/tally";
import { useNowSeconds } from "@/lib/game/useNowSeconds";
import type { LobbyRow } from "@/lib/game/lobby";
import { closedRunTag } from "@/lib/game/run-end";
import LockPanel from "@/components/game/LockPanel";
import { Skeleton } from "@/components/ui";

function StateTag({ row }: { row: LobbyRow }) {
  const slot = row.slot;
  const tone =
    slot.kind === "playable"
      ? "bg-accent text-white"
      : slot.kind === "in-run"
        ? "bg-foreground text-background"
        : slot.kind === "locked"
          ? "border-2 border-warning/60 text-warning"
          : "border-2 border-edge text-muted";
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
    <span className={`inline-flex shrink-0 items-center rounded-md px-2 py-1 text-xs font-bold ${tone}`}>
      {label}
    </span>
  );
}

function SlipHead({ href, children }: { href: string | null; children: ReactNode }) {
  if (href === null) return <div className="px-4 py-4 sm:px-5">{children}</div>;
  return (
    <Link
      href={href}
      className="block rounded-xl px-4 py-4 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:px-5"
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
  /** The run's own entry control, rendered in the slip instead of a link to
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

  return (
    <article
      className={`rounded-xl border-2 bg-surface ${
        row.highlighted ? "border-accent shadow-[var(--shadow-pop)]" : "border-foreground/15"
      }`}
    >
      <SlipHead href={action === undefined ? href : null}>
        {row.highlighted ? (
          <p className="mb-2 text-sm font-semibold text-accent">You were dared into this run</p>
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 font-display text-2xl font-extrabold leading-tight text-balance">
            {displayGoalSpec(pool.goalSpec)}
          </h3>
          <StateTag row={row} />
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <div className="min-w-0">
            <dt className="text-muted">{selfStaked ? "Your stake" : "Entry"}</dt>
            <dd className="font-display text-2xl font-extrabold tabular-nums">
              {formatUsdc(pool.entryFee)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted">Prize pool</dt>
            <dd className="font-display text-2xl font-extrabold tabular-nums text-gold-deep">
              {formatUsdc(pool.balance)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted">Time left</dt>
            <dd className="font-display text-2xl font-extrabold tabular-nums">
              {clock === null ? "--" : formatRunClock(clock)}
            </dd>
          </div>
        </dl>
        <p className="mt-1 text-xs text-muted">Test USDC on Base Sepolia</p>
      </SlipHead>
      {action !== undefined ? (
        // A locked or still-checking run never shows its entry control, even
        // one that decides its own locks: the slip's lock is shown instead,
        // so the stake cannot appear on a board that says "locked".
        <div className="px-4 pb-4 sm:px-5">
          {row.slot.kind === "locked" ? (
            <LockPanel
              lock={row.slot.lock}
              returnTo={returnTo}
              onRetry={onRetry}
              onCheckSensor={onCheckSensor}
            />
          ) : row.slot.kind === "checking" ? (
            <Skeleton className="h-12 w-full rounded-lg" />
          ) : (
            action
          )}
        </div>
      ) : null}
      {action === undefined &&
      row.slot.kind === "locked" &&
      row.slot.lock.kind !== "sensor-unchecked" &&
      row.slot.lock.kind !== "sign-in" ? (
        <div className="px-4 pb-4 sm:px-5">
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
        <p className="px-4 pb-4 text-sm text-muted sm:px-5">
          Locked until I check your sensor. The one tap above opens every run
          at once.
        </p>
      ) : null}
    </article>
  );
}
