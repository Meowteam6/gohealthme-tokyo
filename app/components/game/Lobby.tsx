"use client";

// The Lobby: every run marked playable or locked for your device, with the
// reason and the fix, before any stake. /pools and /c/[token] both render it;
// the challenge link passes its run as `highlightId` so it leads, marked.
//
// The gate logic is the existing join gate, evaluated once for the whole board
// (lib/game/lobby.ts). What used to be five separate refusal screens at the
// join is now a lock on the row, and the "sign so I can check your device"
// step is one button at the top that unlocks every run at once.

import Link from "next/link";
import type { ReactNode } from "react";
import SpotterSays from "@/components/SpotterSays";
import { Skeleton, TAP_TARGET } from "@/components/ui";
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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-3xl font-extrabold">{title}</h2>
        {note}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
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

  return (
    <div className="space-y-8">
      {intro ?? (
        <header className="space-y-4">
          <h1 className="font-display text-6xl font-black leading-[0.9] tracking-tight sm:text-7xl">
            The lobby
          </h1>
          <p className="max-w-lg text-lg text-foreground/80">
            Put a stake on yourself. Your wearable decides. SPOTTER pays you or it
            does not. Test money on Base Sepolia, no real dollars.
          </p>
          <SpotterSays
            surface="pools-header"
            state="idle"
            pose="point"
            say="Playable means I can check it on your wearable. Locked means I tell you why before you stake a cent."
          />
        </header>
      )}

      {signedIn ? (
        <CharacterCard view={view} variant="strip" />
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border-2 border-foreground bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            Sign in to see which runs your wearable can play. One email, and a
            wallet is made for you.
          </p>
          <Link
            href={`/character?next=${encodeURIComponent(returnTo)}`}
            className={`shrink-0 rounded-lg bg-accent font-semibold text-white hover:bg-accent-strong ${TAP_TARGET}`}
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
        <div className="space-y-3" aria-busy="true">
          <p className="sr-only" aria-live="polite">
            Loading the runs
          </p>
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : error || lobby === null ? (
        <div role="alert" className="rounded-xl border-2 border-danger/40 bg-danger/5 p-4">
          <p className="font-semibold">I could not read the runs from Base Sepolia just now.</p>
          <p className="mt-1 text-sm text-foreground/80">Nothing changed on your side.</p>
          <button
            type="button"
            onClick={retry}
            className={`mt-3 rounded-lg border-2 border-foreground font-semibold ${TAP_TARGET}`}
          >
            Read the runs again
          </button>
        </div>
      ) : (
        <>
          {lobby.highlighted !== null ? (
            <Section
              title="Your dare"
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
              <Link href="/dashboard" className="text-sm font-semibold text-accent underline underline-offset-2">
                Open the scoreboard
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
          ) : lobby.highlighted === null ? (
            <section className="rounded-xl border-2 border-dashed border-foreground/30 p-6">
              <h2 className="font-display text-3xl font-extrabold">No open runs right now</h2>
              <p className="mt-2 text-sm text-foreground/80">
                Nobody has put a goal on the board. Start one, or dare a friend
                into one.
              </p>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Link
              href="/pools/create"
              className={`rounded-lg border-2 border-foreground font-semibold hover:bg-foreground hover:text-background ${TAP_TARGET}`}
            >
              Start a run
            </Link>
            <Link
              href="/challenge/new"
              className={`rounded-lg border-2 border-foreground font-semibold hover:bg-foreground hover:text-background ${TAP_TARGET}`}
            >
              Dare a friend
            </Link>
          </div>

          {lobby.closed.length > 0 ? (
            <details className="rounded-xl border-2 border-foreground/15 bg-surface">
              <summary className="flex min-h-12 cursor-pointer items-center px-4 font-semibold">
                Ended runs ({lobby.closed.length})
              </summary>
              <div className="grid gap-3 p-3 lg:grid-cols-2">
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
    </div>
  );
}
