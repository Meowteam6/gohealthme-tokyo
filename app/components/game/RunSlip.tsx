"use client";

// One run in the lobby (docs/DESIGN.md, Night Shift): the same night card the
// landing uses (RunRow), with its last line saying whether YOU can play it.
// A lock shows on the card with its reason and its fix, before any stake. The
// card head links to the run page; the fix and the challenge link's entry
// control sit outside that link so the two are never nested.
//
// Every open row carries the two money chips (what kind of run, what a miss
// does) and the flow's line before anyone opens it (docs/MONEY-FLOWS.md).

import type { ReactNode } from "react";
import type { LobbyRow } from "@/lib/game/lobby";
import type { Fit } from "@/lib/game/wearable-fit";
import { runKind, runName } from "@/lib/game/landing";
import { closedRunTag } from "@/lib/game/run-end";
import LockPanel from "@/components/game/LockPanel";
import { MoneyChips, MoneyLine } from "@/components/game/MoneyTerms";
import RunRow, { FitLine } from "@/components/game/RunRow";
import { Skeleton } from "@/components/ui";
import { useRunMoney } from "@/lib/game/useRunMoney";
import { useEmbeddedWallet } from "@/lib/wallet";

/** The row's last line for its slot, or undefined when the footer says it. */
function slotLine(row: LobbyRow, visitorFit: Fit | null): ReactNode | undefined {
  const slot = row.slot;
  switch (slot.kind) {
    case "playable":
      return (
        <FitLine ok>{slot.proof === "upload" ? "You can play this with an upload" : "You can play this"}</FitLine>
      );
    case "in-run":
      return (
        <FitLine ok tone="in">
          You&apos;re in
        </FitLine>
      );
    case "checking":
      return (
        <div className="mt-2.5 flex items-center gap-2 border-t border-edge pt-2.5" aria-hidden="true">
          <Skeleton className="size-4 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      );
    case "closed":
      return slot.joined ? (
        <FitLine ok tone="in">
          You were in this run
        </FitLine>
      ) : undefined;
    case "cannot-pay":
      return <FitLine ok={false}>This run cannot pay out, so it takes no stakes</FitLine>;
    case "locked":
      // Signed out, every run is "sign in"; the visitor's picked wearable
      // says more, and the sign-in itself sits once at the top of the lobby.
      if (slot.lock.kind === "sign-in") {
        return visitorFit !== null ? <FitLine ok={visitorFit.ok}>{visitorFit.line}</FitLine> : undefined;
      }
      if (slot.lock.kind === "sensor-unchecked") {
        return <FitLine ok={false}>Locked until I check your wearable, one tap above</FitLine>;
      }
      return undefined;
  }
}

export default function RunSlip({
  row,
  returnTo,
  action,
  onRetry,
  onCheckSensor,
  players = null,
  visitorFit = null,
}: {
  row: LobbyRow;
  returnTo: string;
  /** The run's own entry control, rendered on the card instead of a link to
   *  the run page (the challenge link: a private challenge's page is closed
   *  to anyone not yet in it, so entering happens here). Hidden while the
   *  row is locked or checking. */
  action?: ReactNode;
  /** Re-reads a failed join check ("Check again"). */
  onRetry?: () => void;
  /** The one-tap sensor check, for a locked highlighted row. */
  onCheckSensor?: () => Promise<boolean>;
  /** participantCount, when read. */
  players?: number | null;
  /** Signed out: whether the wearable the visitor picked can check this run. */
  visitorFit?: Fit | null;
}) {
  const { pool, slot } = row;
  const lock = slot.kind === "locked" ? slot.lock : null;
  const { address } = useEmbeddedWallet();
  // The chips and the line only while money can still go in. The highlighted
  // challenge row sits under the challenge's own terms, so it shows the chips
  // alone.
  const money = useRunMoney({
    pool,
    players,
    includeJoiner: slot.kind !== "in-run",
    viewer: address,
    feeBps: null,
  });
  const open = slot.kind !== "closed" && slot.kind !== "cannot-pay";
  const moneyBlock = open && money !== null ? (
    <div className="mt-2.5 [&>*+*]:mt-2">
      <MoneyChips kind={money.kind?.chip ?? null} miss={money.miss} />
      {!row.highlighted && money.copy !== null ? <MoneyLine copy={money.copy} /> : null}
    </div>
  ) : null;
  const fitLine = slotLine(row, visitorFit);
  const quiet =
    lock !== null && (lock.kind !== "sign-in" || (visitorFit !== null && !visitorFit.ok));

  // A locked or still-checking run never shows its entry control, even one
  // that decides its own locks: the lock shows instead, so the stake cannot
  // appear on a board that says "locked".
  let footer: ReactNode = null;
  if (action !== undefined) {
    footer =
      lock !== null ? (
        <LockPanel lock={lock} returnTo={returnTo} onRetry={onRetry} onCheckSensor={onCheckSensor} />
      ) : slot.kind === "checking" ? (
        <Skeleton className="h-[52px] w-full rounded-control" />
      ) : (
        action
      );
  } else if (lock !== null && lock.kind !== "sensor-unchecked" && lock.kind !== "sign-in") {
    footer = (
      <LockPanel lock={lock} returnTo={returnTo} onRetry={onRetry} onCheckSensor={onCheckSensor} compact />
    );
  }

  return (
    <RunRow
      href={action === undefined ? `/pools/${pool.id.toString()}` : null}
      name={runName(pool)}
      kind={runKind(pool.goalSpec)}
      periodEnd={pool.periodEnd}
      players={slot.kind === "closed" ? null : players}
      entryFee={pool.entryFee}
      balance={pool.balance}
      stakeLabel={pool.bountyModel === 2 ? "Stake" : "Entry"}
      eyebrow={row.highlighted ? "You were challenged into this run" : undefined}
      status={slot.kind === "closed" ? closedRunTag(row.phase) : undefined}
      tone={row.highlighted ? "highlight" : quiet ? "locked" : "default"}
      fit={
        moneyBlock !== null || fitLine !== undefined ? (
          <>
            {moneyBlock}
            {fitLine}
          </>
        ) : undefined
      }
      footer={footer}
      headingLevel="h3"
    />
  );
}
