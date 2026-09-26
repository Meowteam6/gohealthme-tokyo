"use client";

// The Run (docs/DESIGN.md). One big number (time left in the run), the nights
// as pebbles from the progress read scoped to this run's period and metric,
// SPOTTER posed by the goal and the clock (asleep in a river-ink night panel
// after dark on a sleep run, keeping watch by day, lifting or running on a
// workout or step goal), and who else is in. Stake and pot sit under the big
// number in gold, because they are money. The waits are a run timer, never a
// "pending" label.

import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import EnsName from "@/components/ens/EnsName";
import Spotter, { SpotterBubble } from "@/components/spotter/Spotter";
import { Money, Skeleton } from "@/components/ui";
import NightTally from "@/components/game/NightTally";
import { PRIMARY_LINK, TEXT_LINK } from "@/components/game/link-styles";
import {
  displayGoalSpec,
  evidenceTypeOf,
  fetchParticipant,
  fetchParticipants,
  formatUsdc,
  type PoolInfo,
} from "@/lib/contract";
import { classifyWearableGoal } from "@/lib/wearable-goal";
import {
  fetchProviderState,
  providerAuthReason,
  providerAwaitingFirstSync,
  providerDownReason,
  providerMetricUnavailable,
  providerQueryKey,
} from "@/lib/wearable-provider";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { nightTally, runClock, type RunStanding } from "@/lib/game/tally";
import { runFigureOf, runSceneOf } from "@/lib/game/run-scene";
import { useNowSeconds } from "@/lib/game/useNowSeconds";

const STANDING_LINE: Record<RunStanding, string> = {
  "on-target": "That is enough nights. Have me check it and the verdict is mine to make.",
  alive: "Still alive. Tonight counts. Wear the thing.",
  out: "Not enough nights left to make it. I am not going to pretend otherwise.",
  over: "Time is up. The verdict is all that is left.",
};

interface Player {
  address: string;
  hit: boolean;
}

/** Who else is in the run, and who already banked the goal, from the chain. */
function usePlayers(poolId: bigint) {
  return useQuery({
    queryKey: ["run-players", poolId.toString()],
    queryFn: async (): Promise<Player[]> => {
      const addresses = await fetchParticipants(poolId);
      const infos = await Promise.all(addresses.map((a) => fetchParticipant(poolId, a)));
      return addresses.map((address, i) => ({
        address,
        hit: infos[i].resultRecorded && infos[i].verdict,
      }));
    },
    staleTime: 30_000,
  });
}

export default function RunBoard({
  pool,
  address,
  promptForData,
  showLink = false,
}: {
  pool: PoolInfo;
  address: `0x${string}`;
  /** The dashboard asks for a signature to read your own data; the run page
   *  does not open a prompt on load. */
  promptForData: boolean;
  showLink?: boolean;
}) {
  const requestAuth = useWalletAuth();
  const now = useNowSeconds();
  const wearable = evidenceTypeOf(pool.goalSpec) === "wearable";
  const spec = classifyWearableGoal(pool.goalSpec);
  const metric = spec.metric ?? undefined;

  const progressQuery = useQuery({
    queryKey: providerQueryKey(address, pool.id, metric),
    queryFn: () =>
      fetchProviderState(
        address,
        promptForData
          ? requestAuth
          : (options) => requestAuth({ ...options, cachedOnly: true }),
        pool,
        metric,
      ),
    enabled: wearable,
    retry: false,
  });
  const players = usePlayers(pool.id);

  const state = progressQuery.data;
  const banked = state?.kind === "ok" ? state.progress.streakDays : null;
  const tally =
    now === null || !wearable || providerAwaitingFirstSync(state)
      ? null
      : nightTally({
          goalDays: spec.goalDays,
          banked,
          periodStart: pool.periodStart,
          periodEnd: pool.periodEnd,
          nowSec: now,
        });
  const clock = now === null ? null : runClock(pool.periodStart, pool.periodEnd, now);
  const figure = runFigureOf(clock);
  // now is null on the server and the hydrating render, so the local hour is
  // only read on the client and the markup always matches.
  const scene = runSceneOf({
    metric: wearable ? spec.metric : null,
    localHour: now === null ? 12 : new Date(now * 1000).getHours(),
    ended: clock?.ended === true,
  });
  const night = scene === "run-night-sleep";
  const selfStaked = pool.bountyModel === 2;

  const playerList = players.data ?? [];
  const hitCount = playerList.filter((p) => p.hit).length;
  const goal = displayGoalSpec(pool.goalSpec);

  // The nights, in whichever state the wearable read is in. Every branch
  // says what is true and what, if anything, the player can do.
  let nights: ReactNode;
  const note = night ? "text-background/85" : "text-foreground/80";
  if (!wearable) {
    nights = (
      <p className={`text-sm ${note}`}>
        This run is proven with a document, not a wearable, so there is no
        nightly tally. Hand SPOTTER the proof on the run page.
      </p>
    );
  } else if (progressQuery.isLoading) {
    nights = (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-5 w-48" />
      </div>
    );
  } else if (providerDownReason(state) !== null) {
    nights = (
      <p className={`text-sm ${note}`}>
        The wearable service is not answering me right now, so I cannot count
        your nights this minute. Nights you already slept still count once it
        is back.
      </p>
    );
  } else if (providerAuthReason(state) !== null) {
    nights = (
      <div className="space-y-3">
        <p className={`text-sm ${note}`}>
          Your nights are private, so I need one signature to count them. Free,
          no transaction.
        </p>
        <button
          type="button"
          onClick={() => {
            void requestAuth({ refresh: true }).then(() => progressQuery.refetch());
          }}
          className={PRIMARY_LINK}
        >
          Show my nights
        </button>
      </div>
    );
  } else if (providerMetricUnavailable(state)) {
    nights = (
      <p className={`text-sm font-bold ${night ? "text-gold" : "text-warning"}`}>
        Your wearable syncs, and it does not report what this run is scored on.
        That is the hardware. Your result settles on what the run can read.
      </p>
    );
  } else if (providerAwaitingFirstSync(state)) {
    nights = (
      <p className={`text-sm ${note}`}>
        Your wearable is paired and has not sent a night yet. The first sync
        usually lands within minutes. Nothing is counted against you while you
        wait.
      </p>
    );
  } else if (tally !== null) {
    nights = <NightTally tally={tally} onDark={night} />;
  } else {
    nights = <p className={`text-sm ${night ? "text-background/85" : "text-muted"}`}>No nights counted yet.</p>;
  }

  const line = tally !== null ? STANDING_LINE[tally.standing] : undefined;

  return (
    <article className="space-y-4" aria-label={`Run: ${goal}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-3">
        <h2 className="min-w-0 break-words font-display text-2xl font-extrabold leading-display tracking-display text-balance sm:text-3xl">
          {goal}
        </h2>
        {showLink ? (
          <Link href={`/pools/${pool.id.toString()}`} className={TEXT_LINK}>
            Open this run
          </Link>
        ) : null}
      </div>

      {night ? (
        <section
          aria-label="Tonight"
          className="overflow-hidden rounded-3xl bg-foreground p-4 text-background sm:p-5"
        >
          <p className="text-sm text-background/80">Time left in the run</p>
          <p className="font-display text-[clamp(2.75rem,15vw,4rem)] font-extrabold leading-[0.9] tracking-[-0.03em] tabular-nums">
            {figure.figure}
          </p>
          <div className="mt-4">{nights}</div>
          <div className="mt-3 flex items-end justify-between gap-2">
            {line !== undefined ? <SpotterBubble line={line} tail="side" /> : <span />}
            <Spotter state="run-night-sleep" size="sm" className="-mb-5 -mr-5 shrink-0" />
          </div>
        </section>
      ) : (
        <section aria-label="The run" className="rounded-3xl border border-edge bg-surface p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-[clamp(2.75rem,13vw,4rem)] font-extrabold leading-[0.9] tracking-[-0.03em] tabular-nums">
                {figure.figure}
              </p>
              <p className="mt-1 text-sm text-muted">{figure.caption}</p>
            </div>
            <Spotter state={scene} size="xs" className="shrink-0 sm:hidden" />
            <Spotter state={scene} size="sm" className="hidden shrink-0 sm:inline-flex" />
          </div>
          <div className="mt-4">{nights}</div>
          {line !== undefined ? (
            <div className="mt-4">
              <SpotterBubble line={line} tail="down" />
            </div>
          ) : null}
        </section>
      )}

      <dl className="flex flex-wrap gap-x-6 gap-y-2 px-1">
        <div>
          <dt className="text-sm text-muted">{selfStaked ? "Your stake" : "Entry"}</dt>
          <dd>
            <Money usd={formatUsdc(pool.entryFee)} size="lg" />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">In the pot</dt>
          <dd>
            <Money usd={formatUsdc(pool.balance)} size="lg" />
          </dd>
        </div>
      </dl>

      <section aria-label="Who is in" className="rounded-3xl border border-edge bg-surface p-4 sm:p-5">
        <h3 className="font-display text-xl font-bold leading-display">Who is in</h3>
        {players.isLoading ? (
          <Skeleton className="mt-3 h-6 w-40" />
        ) : players.isError ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3">
            <p className="text-sm text-muted">I could not read the players just now.</p>
            <button type="button" onClick={() => void players.refetch()} className={TEXT_LINK}>
              Read them again
            </button>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-foreground/80">
              {playerList.length} in the run, {hitCount} already banked the goal.
            </p>
            <ul className="mt-3 divide-y divide-edge">
              {playerList.slice(0, 8).map((p) => {
                const you = p.address.toLowerCase() === address.toLowerCase();
                return (
                  <li key={p.address} className="flex min-h-11 items-center justify-between gap-3 py-1.5">
                    <span className={`min-w-0 truncate text-sm ${you ? "font-bold" : ""}`}>
                      <EnsName address={p.address} />
                      {you ? <span className="text-muted"> (you)</span> : null}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-2 text-sm">
                      <span
                        aria-hidden="true"
                        className={`h-3.5 w-5 border-2 ${
                          p.hit ? "border-foreground bg-gold" : "border-foreground bg-surface"
                        }`}
                        style={{ borderRadius: "50% 50% 46% 54% / 60% 60% 40% 40%" }}
                      />
                      {p.hit ? "Banked the goal" : "Still going"}
                    </span>
                  </li>
                );
              })}
              {playerList.length > 8 ? (
                <li className="flex min-h-11 items-center text-sm text-muted">
                  and {playerList.length - 8} more
                </li>
              ) : null}
            </ul>
          </>
        )}
      </section>
    </article>
  );
}
