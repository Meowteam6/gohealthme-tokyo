"use client";

// The Run: one run's scoreboard. Prize, stake and time left on the panel, the
// night-by-night tally from the progress read scoped to this run's period and
// metric, tonight's standing in SPOTTER's words, and who else is still in.
// The waits are a run timer, never a "pending" label.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import EnsName from "@/components/ens/EnsName";
import SpotterSays from "@/components/SpotterSays";
import { Skeleton, TAP_TARGET } from "@/components/ui";
import NightTally from "@/components/game/NightTally";
import Scoreboard from "@/components/game/Scoreboard";
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
import { formatRunClock, nightTally, runClock, type RunStanding } from "@/lib/game/tally";
import { useNowSeconds } from "@/lib/game/useNowSeconds";

const STANDING_LINE: Record<RunStanding, { say: string; pose: string }> = {
  "on-target": {
    say: "That is enough nights. Have me check it and the verdict is mine to make.",
    pose: "flex",
  },
  alive: {
    say: "Still alive. Tonight counts. Wear the thing.",
    pose: "cheer",
  },
  out: {
    say: "Not enough nights left to make it. I am not going to pretend otherwise.",
    pose: "facepalm",
  },
  over: {
    say: "Time is up. The verdict is all that is left.",
    pose: "detective",
  },
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
  const selfStaked = pool.bountyModel === 2;

  const playerList = players.data ?? [];
  const hitCount = playerList.filter((p) => p.hit).length;

  return (
    <article className="space-y-4" aria-label={`Run: ${displayGoalSpec(pool.goalSpec)}`}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="font-display text-3xl font-extrabold leading-tight text-balance sm:text-4xl">
          {displayGoalSpec(pool.goalSpec)}
        </h2>
        {showLink ? (
          <Link
            href={`/pools/${pool.id.toString()}`}
            className={`-mr-4 font-semibold text-accent underline underline-offset-2 ${TAP_TARGET}`}
          >
            Open this run
          </Link>
        ) : null}
      </div>

      <Scoreboard
        caption="Run scoreboard"
        cells={[
          { label: "Prize pool", value: formatUsdc(pool.balance), tone: "money", unit: "test USDC" },
          {
            label: selfStaked ? "Your stake" : "Entry",
            value: formatUsdc(pool.entryFee),
            tone: "money",
            unit: "test USDC",
          },
          {
            label: "Time left",
            value: clock === null ? "--" : formatRunClock(clock),
            unit: clock?.ended === true ? "verdict next" : "on the clock",
          },
        ]}
      />

      <div className="rounded-xl border-2 border-foreground/15 bg-surface p-4 sm:p-5">
        {!wearable ? (
          <p className="text-sm text-foreground/80">
            This run is proven with a document, not a wearable, so there is no
            nightly tally. Hand SPOTTER the proof on the run page.
          </p>
        ) : progressQuery.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-10 w-72" />
          </div>
        ) : providerDownReason(state) !== null ? (
          <p className="text-sm text-foreground/80">
            The wearable service is not answering me right now, so I cannot
            count your nights this minute. Nights you already slept still count
            once it is back.
          </p>
        ) : providerAuthReason(state) !== null ? (
          <div className="space-y-2">
            <p className="text-sm text-foreground/80">
              Your nights are private, so I need one signature to count them.
              Free, no transaction.
            </p>
            <button
              type="button"
              onClick={() => {
                void requestAuth({ refresh: true }).then(() => progressQuery.refetch());
              }}
              className={`rounded-lg bg-accent font-semibold text-white hover:bg-accent-strong ${TAP_TARGET}`}
            >
              Show my nights
            </button>
          </div>
        ) : providerMetricUnavailable(state) ? (
          <p className="text-sm text-warning">
            Your wearable syncs, and it does not report what this run is scored
            on. That is the hardware. Your result settles on what the run can
            read.
          </p>
        ) : providerAwaitingFirstSync(state) ? (
          <p className="text-sm text-foreground/80">
            Your wearable is paired and has not sent a night yet. The first sync
            usually lands within minutes. Nothing is counted against you while
            you wait.
          </p>
        ) : tally !== null ? (
          <div className="space-y-4">
            <NightTally tally={tally} />
            <SpotterSays
              surface="dashboard-header"
              state="streak-nudge"
              pose={STANDING_LINE[tally.standing].pose}
              say={STANDING_LINE[tally.standing].say}
            />
          </div>
        ) : (
          <p className="text-sm text-muted">No nights counted yet.</p>
        )}
      </div>

      <div className="rounded-xl border-2 border-foreground/15 bg-surface p-4 sm:p-5">
        <h3 className="font-display text-2xl font-extrabold">Who is in</h3>
        {players.isLoading ? (
          <Skeleton className="mt-2 h-6 w-40" />
        ) : players.isError ? (
          <p className="mt-1 text-sm text-muted">I could not read the players just now.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-foreground/80">
              {playerList.length} in the run, {hitCount} already banked the goal.
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {playerList.slice(0, 8).map((p) => (
                <li
                  key={p.address}
                  className={`inline-flex min-h-9 items-center gap-2 rounded-md border-2 px-2 text-sm ${
                    p.hit ? "border-accent text-accent" : "border-edge"
                  } ${p.address.toLowerCase() === address.toLowerCase() ? "font-semibold" : ""}`}
                >
                  <span
                    aria-hidden="true"
                    className={`size-2 rounded-full ${p.hit ? "bg-accent" : "bg-foreground/40"}`}
                  />
                  <EnsName address={p.address} />
                  <span className="sr-only">{p.hit ? "banked the goal" : "still going"}</span>
                </li>
              ))}
              {playerList.length > 8 ? (
                <li className="inline-flex min-h-9 items-center text-sm text-muted">
                  and {playerList.length - 8} more
                </li>
              ) : null}
            </ul>
          </>
        )}
      </div>
    </article>
  );
}
