"use client";

// The Lobby: every run marked playable or locked for your device, with the
// reason and the fix, before any stake. /pools and /c/[token] both render it;
// the challenge link passes its run as `highlightId` so it leads, marked.
//
// The gate logic is the existing join gate, evaluated once for the whole board
// (lib/game/lobby.ts). What used to be five separate refusal screens at the
// join is a lock on the card, and the "sign so I can check your wearable" step
// is one button at the top that unlocks every run at once.
//
// Night Shift (docs/DESIGN.md): runs are the landing's night cards (RunRow),
// SPOTTER stands on the top card and nowhere else, and gold is only money.
// Signed out, "What do you wear?" marks every run for a wearable before any
// account, from the same capability table the landing reads.

import Link from "next/link";
import type { ReactNode } from "react";
import CharacterCard from "@/components/game/CharacterCard";
import LockPanel from "@/components/game/LockPanel";
import RunSlip from "@/components/game/RunSlip";
import WearableChips from "@/components/game/WearableChips";
import Perch from "@/components/spotter/Perch";
import { Button, ButtonLink, Card, EmptyState, Fine, Skeleton, TEXT_LINK } from "@/components/ui";
import { lobbyNeedsSensorCheck, type LobbyRow } from "@/lib/game/lobby";
import { useCharacter } from "@/lib/game/useCharacter";
import { useLobby } from "@/lib/game/useLobby";
import { usePlayerCounts, usePoolsQuery } from "@/lib/game/useOpenRuns";
import { useWearPick } from "@/lib/game/useWearPick";
import {
  brandFit,
  brandHint,
  type Fit,
  type WearableAvailability,
} from "@/lib/game/wearable-fit";

const GRID = "m-0 grid list-none gap-2.5 p-0 min-[900px]:grid-cols-3 min-[900px]:gap-4";

function Section({
  title,
  note,
  rows,
  returnTo,
  action,
  onRetry,
  onCheckSensor,
  playersOf,
  fitOf,
}: {
  title: string;
  note?: ReactNode;
  rows: LobbyRow[];
  returnTo: string;
  action?: ReactNode;
  onRetry?: () => void;
  onCheckSensor?: () => Promise<boolean>;
  playersOf: (row: LobbyRow) => number | null;
  fitOf: (row: LobbyRow) => Fit | null;
}) {
  if (rows.length === 0) return null;
  const id = `lobby-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id={id} className="type-title m-0 text-[2rem] min-[900px]:text-[2.5rem]">
          {title}
        </h2>
        {note}
      </div>
      <ul className={`${GRID} mt-3.5`}>
        {rows.map((row) => (
          <li key={row.pool.id.toString()}>
            <RunSlip
              row={row}
              returnTo={returnTo}
              action={row.highlighted ? action : undefined}
              onRetry={onRetry}
              onCheckSensor={onCheckSensor}
              players={playersOf(row)}
              visitorFit={fitOf(row)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RowsLoading() {
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">
        Reading the runs
      </p>
      <ul className={GRID} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <Skeleton className="h-[132px] rounded-2xl" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Lobby({
  highlightId = null,
  returnTo = "/pools",
  intro,
  highlightAction,
  availability,
}: {
  highlightId?: string | null;
  returnTo?: string;
  /** Replaces the lobby heading (the challenge link's header). */
  intro?: ReactNode;
  /** The highlighted run's entry control (the challenge link's accept). */
  highlightAction?: ReactNode;
  /** Which wearables this build can pair, read on the server. Given, a
   *  signed-out visitor gets "What do you wear?"; absent, no picker. */
  availability?: WearableAvailability;
}) {
  const view = useCharacter();
  const { lobby, loading, error, retry, outage, retryChecks } = useLobby(view, highlightId);
  const signedIn = view.authenticated && view.address !== null;
  const nothingOpen =
    lobby !== null && lobby.open.length === 0 && lobby.highlighted === null;

  // The same ["pools"] query useLobby reads, so the player counts cost one
  // batch of participantCount reads and nothing more.
  const poolsQuery = usePoolsQuery();
  const counts = usePlayerCounts(poolsQuery.data?.pools, poolsQuery.data?.asOfSeconds);
  const playersOf = (row: LobbyRow): number | null => counts.data?.get(row.pool.id.toString()) ?? null;

  const [picked, setPick] = useWearPick();
  const picker = !signedIn && availability !== undefined ? availability : null;
  const fitOf = (row: LobbyRow): Fit | null =>
    picker !== null && picked !== null ? brandFit(picked, row.pool.goalSpec, picker) : null;
  const openSpecs =
    lobby === null
      ? []
      : [lobby.highlighted, ...lobby.open].filter((r): r is LobbyRow => r !== null).map((r) => r.pool.goalSpec);
  const hint = picker !== null && picked !== null && lobby !== null ? brandHint(picked, openSpecs, picker) : null;

  // One pose per screen: SPOTTER stands on the top card unless the empty
  // state below brings its own.
  const perched = !nothingOpen && !(error && !loading);
  const next = encodeURIComponent(returnTo);

  const topCard = signedIn ? (
    <CharacterCard view={view} variant="strip" />
  ) : (
    <Card>
      {picker !== null ? (
        <>
          <WearableChips picked={picked} onPick={setPick} hint={hint} />
          <div className="mt-4 border-t border-edge pt-4" />
        </>
      ) : null}
      <div className="flex flex-col gap-3 min-[640px]:flex-row min-[640px]:items-center min-[640px]:justify-between min-[640px]:gap-6">
        <p className="m-0 max-w-[52ch] text-[0.9375rem] leading-normal text-muted">
          <b className="font-semibold text-foreground">Sign in and I check your own wearable against every run,</b>{" "}
          before any stake. One email, and a wallet is made for you.
        </p>
        <ButtonLink href={`/character?next=${next}`} className="flex-none">
          Sign in
        </ButtonLink>
      </div>
    </Card>
  );

  return (
    <div className="grid gap-8 min-[900px]:gap-12">
      {intro ?? (
        <header>
          <h1 className="type-display m-0 text-[2.75rem] min-[900px]:text-[4rem]">The lobby</h1>
          <p className="m-0 mt-3 max-w-[44ch] text-[1.0625rem] leading-[1.45] text-muted min-[900px]:text-[1.3125rem]">
            Every open run, marked for your wearable before you stake.
          </p>
          <Fine className="mt-2">Test USDC during beta. No real money moves.</Fine>
        </header>
      )}

      <div className="grid gap-3">
        {perched ? (
          // From 900px the header's right side is empty, so SPOTTER stands in
          // it (the perch lifts by its own reserve) instead of opening a gap.
          <Perch
            state="lobby"
            width={[80, 120]}
            side="right"
            inset={[16, 32]}
            decorative
            className="min-[900px]:-mt-[calc(var(--perch-pad)-12px)]"
          >
            {topCard}
          </Perch>
        ) : (
          topCard
        )}
        {lobby !== null && lobbyNeedsSensorCheck(lobby) ? (
          <LockPanel lock={{ kind: "sensor-unchecked" }} returnTo={returnTo} onCheckSensor={view.checkSensor} />
        ) : null}
        {outage ? <LockPanel lock={{ kind: "outage" }} returnTo={returnTo} /> : null}
      </div>

      {loading ? (
        <RowsLoading />
      ) : error || lobby === null ? (
        <Card role="alert">
          <p className="m-0 text-lg font-semibold">I could not read the runs from Base Sepolia just now.</p>
          <p className="m-0 mt-1 text-[0.9375rem] text-muted">Nothing changed on your side, and nothing was staked.</p>
          <Button variant="secondary" size="sm" onClick={retry} className="mt-3">
            Read the runs again
          </Button>
        </Card>
      ) : (
        <>
          {lobby.highlighted !== null ? (
            <Section
              title="Your challenge"
              rows={[lobby.highlighted]}
              action={highlightAction}
              returnTo={returnTo}
              onRetry={retryChecks}
              onCheckSensor={view.checkSensor}
              playersOf={playersOf}
              fitOf={fitOf}
            />
          ) : null}
          <Section
            title="Your runs"
            rows={lobby.mine}
            returnTo={returnTo}
            playersOf={playersOf}
            fitOf={fitOf}
            note={
              <Link href="/dashboard" className={TEXT_LINK}>
                Open My runs
              </Link>
            }
          />
          {lobby.open.length > 0 ? (
            <Section
              title={lobby.highlighted !== null ? "Other runs" : "Open runs"}
              rows={lobby.open}
              returnTo={returnTo}
              onRetry={retryChecks}
              onCheckSensor={view.checkSensor}
              playersOf={playersOf}
              fitOf={fitOf}
            />
          ) : null}

          {nothingOpen ? (
            <div className="grid gap-2">
              <EmptyState
                title="No open runs right now"
                line="Nothing running. I'm on break."
                detail="Nobody has put a goal on the board. Start one and I will read the wearables."
                action={<ButtonLink href="/pools/create">Start a run</ButtonLink>}
              />
              <p className="m-0 text-center">
                <Link href="/challenge/new" className={TEXT_LINK}>
                  Or challenge a friend into one
                </Link>
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/pools/create" variant="secondary">
                Start a run
              </ButtonLink>
              <ButtonLink href="/challenge/new" variant="secondary">
                Challenge a friend
              </ButtonLink>
            </div>
          )}

          {lobby.closed.length > 0 ? (
            <details className="group rounded-2xl bg-surface shadow-[inset_0_0_0_1px_var(--border)]">
              <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-foreground [&::-webkit-details-marker]:hidden">
                <span className="num">Ended runs ({lobby.closed.length})</span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                  className="flex-none text-haze transition-transform duration-[120ms] group-open:rotate-90"
                >
                  <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              <ul className={`${GRID} px-3 pb-3`}>
                {lobby.closed.map((row) => (
                  <li key={row.pool.id.toString()}>
                    <RunSlip row={row} returnTo={returnTo} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}
