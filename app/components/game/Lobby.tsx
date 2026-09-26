"use client";

// The Lobby: every run marked playable or locked for your device, with the
// reason and the fix, before any stake. /pools and /c/[token] both render it;
// the challenge link passes its run as `highlightId` so it leads, marked.
//
// The gate logic is the existing join gate, evaluated once for the whole board
// (lib/game/lobby.ts). What used to be five separate refusal screens at the
// join is now a lock on the row, and the "sign so I can check your device"
// step is one button at the top that unlocks every run at once.
//
// Riverbank (docs/DESIGN.md): rows over cards, stake to pot in gold, SPOTTER
// peeking up from the bottom edge.

import Link from "next/link";
import type { ReactNode } from "react";
import Spotter from "@/components/spotter/Spotter";
import { EmptyState, Skeleton, buttonClasses, TEXT_LINK } from "@/components/ui";
import CharacterCard from "@/components/game/CharacterCard";
import LockPanel from "@/components/game/LockPanel";
import RunSlip from "@/components/game/RunSlip";
import { useCharacter } from "@/lib/game/useCharacter";
import { useLobby } from "@/lib/game/useLobby";
import { lobbyNeedsSensorCheck, type LobbyRow } from "@/lib/game/lobby";

function Section({
  title,
  note,
  rows,
  returnTo,
  action,
  onRetry,
  onCheckSensor,
}: {
  title: string;
  note?: ReactNode;
  rows: LobbyRow[];
  returnTo: string;
  action?: ReactNode;
  onRetry?: () => void;
  onCheckSensor?: () => Promise<boolean>;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="font-display text-[1.75rem] font-extrabold leading-display tracking-display">
          {title}
        </h2>
        {note}
      </div>
      <div className="grid gap-2.5 lg:grid-cols-2">
        {rows.map((row) => (
          <RunSlip
            key={row.pool.id.toString()}
            row={row}
            returnTo={returnTo}
            action={row.highlighted ? action : undefined}
            onRetry={onRetry}
            onCheckSensor={onCheckSensor}
          />
        ))}
      </div>
    </section>
  );
}

export default function Lobby({
  highlightId = null,
  returnTo = "/pools",
  intro,
  highlightAction,
}: {
  highlightId?: string | null;
  returnTo?: string;
  /** Replaces the lobby heading (the challenge link's dare header). */
  intro?: ReactNode;
  /** The highlighted run's entry control (the challenge link's accept). */
  highlightAction?: ReactNode;
}) {
  const view = useCharacter();
  const { lobby, loading, error, retry, outage, retryChecks } = useLobby(view, highlightId);
  const signedIn = view.authenticated && view.address !== null;
  const nothingOpen =
    lobby !== null && lobby.open.length === 0 && lobby.highlighted === null;

  return (
    <div className="space-y-8">
      {intro ?? (
        <header className="space-y-3">
          <h1 className="font-display text-[clamp(2.5rem,12vw,4rem)] font-extrabold leading-display tracking-[-0.03em]">
            The lobby
          </h1>
          <p className="max-w-lg text-base text-foreground/85 sm:text-lg">
            Put money on yourself. Everyone stakes the same and your wearable
            decides: hit your goal and your stake comes back with a share of
            the stakes that missed.
          </p>
          <p className="text-sm text-muted">Base Sepolia test money, beta. No real dollars.</p>
        </header>
      )}

      {signedIn ? (
        <CharacterCard view={view} variant="strip" />
      ) : (
        <div className="flex flex-col gap-3 rounded-[20px] border border-edge bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            Sign in to see which runs your wearable can play. One email, and a
            wallet is made for you.
          </p>
          <Link
            href={`/character?next=${encodeURIComponent(returnTo)}`}
            className={`shrink-0 ${buttonClasses()}`}
          >
            Sign in
          </Link>
        </div>
      )}

      {lobby !== null && lobbyNeedsSensorCheck(lobby) ? (
        <LockPanel
          lock={{ kind: "sensor-unchecked" }}
          returnTo={returnTo}
          onCheckSensor={view.checkSensor}
        />
      ) : null}
      {outage ? <LockPanel lock={{ kind: "outage" }} returnTo={returnTo} /> : null}

      {loading ? (
        <div className="space-y-2.5" aria-busy="true">
          <p className="sr-only" aria-live="polite">
            Loading the runs
          </p>
          <Skeleton className="h-24 rounded-[20px]" />
          <Skeleton className="h-24 rounded-[20px]" />
          <Skeleton className="h-24 rounded-[20px]" />
        </div>
      ) : error || lobby === null ? (
        <div
          role="alert"
          className="flex gap-3 rounded-[20px] border-2 border-danger/40 bg-surface p-4"
        >
          <Spotter state="error" size="inline" decorative className="shrink-0 self-start" />
          <div className="min-w-0">
            <p className="font-bold">I could not read the runs from Base Sepolia just now.</p>
            <p className="mt-1 text-sm text-foreground/85">Nothing changed on your side.</p>
            <button type="button" onClick={retry} className={`mt-3 ${buttonClasses({ variant: "secondary" })}`}>
              Read the runs again
            </button>
          </div>
        </div>
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
            />
          ) : null}
          <Section
            title="Your runs"
            rows={lobby.mine}
            returnTo={returnTo}
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
            />
          ) : null}

          {nothingOpen ? (
            <div className="space-y-2">
              <EmptyState
                title="No open runs right now"
                line="Nothing running. I'm on break."
                detail="Nobody has put a goal on the board. Start one and I will read the wearables."
                action={
                  <Link href="/pools/create" className={buttonClasses()}>
                    Start a run
                  </Link>
                }
              />
              <p className="text-center">
                <Link href="/challenge/new" className={TEXT_LINK}>
                  Or challenge a friend into one
                </Link>
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Link href="/pools/create" className={buttonClasses({ variant: "secondary" })}>
                Start a run
              </Link>
              <Link href="/challenge/new" className={buttonClasses({ variant: "secondary" })}>
                Challenge a friend
              </Link>
            </div>
          )}

          {lobby.closed.length > 0 ? (
            <details className="rounded-[20px] border border-edge bg-surface">
              <summary className="flex min-h-12 cursor-pointer items-center px-4 font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground">
                Ended runs ({lobby.closed.length})
              </summary>
              <div className="grid gap-2.5 p-3 lg:grid-cols-2">
                {lobby.closed.map((row) => (
                  <RunSlip
                    key={row.pool.id.toString()}
                    row={row}
                    returnTo={returnTo}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </>
      )}

      {/* SPOTTER peeks up from the bottom edge of the lobby. His line is the
          lobby's promise: locks are told before a stake, never after. */}
      {intro === undefined && !nothingOpen ? (
        <div className="-mb-8 flex justify-end">
          <Spotter
            state="lobby"
            size="sm"
            line="Locked means I tell you why before you stake a cent."
            linePlacement="side"
          />
        </div>
      ) : null}
    </div>
  );
}
