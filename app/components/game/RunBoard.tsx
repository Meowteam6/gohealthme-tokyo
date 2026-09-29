"use client";

// The Run (docs/DESIGN.md). Time left in the run as the one figure, the nights
// as pebbles from the progress read scoped to this run's period and metric,
// SPOTTER's line for where the run stands, the money in gold, and who else is
// in. The run page reads the same pieces (useRunNights, usePlayers) into its
// Your night and Who's in cards; the dashboard renders the whole board. No
// otter here: a board can repeat down a page, and a viewport gets one pose.

import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import EnsName from "@/components/ens/EnsName";
import SpotterCaption from "@/components/spotter/SpotterCaption";
import { Card, Skeleton, Stat, StatRow, TEXT_LINK } from "@/components/ui";
import NightTally from "@/components/game/NightTally";
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
import { cachedOnlyRequester } from "@/lib/client-auth";
import VerifyWalletAction from "@/components/VerifyWalletAction";
import { nightTally, runClock, type NightTally as Tally, type RunStanding } from "@/lib/game/tally";
import { runFigureOf } from "@/lib/game/run-scene";
import { useNowSeconds } from "@/lib/game/useNowSeconds";
import { commitmentReminder, hitRange, recordsMissesOf } from "@/lib/game/commitment-copy";
import { useCommitmentFee } from "@/lib/game/useCommitmentFee";

export const STANDING_LINE: Record<RunStanding, string> = {
  "on-target": "That is enough nights. Have me check it and the verdict is mine to make.",
  alive: "Still alive. Tonight counts. Wear the thing.",
  out: "Not enough nights left to make it. I am not going to pretend otherwise.",
  over: "Time is up. The verdict is all that is left.",
};

export interface Player {
  address: string;
  hit: boolean;
}

/** Who is in the run, and who already banked the goal, from the chain. */
export function usePlayers(poolId: bigint) {
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

/**
 * The nights for one player on one run, in whichever state the wearable read
 * is in. Every branch says what is true and what, if anything, the player can
 * do. The read is cachedOnly everywhere: opening a page never opens a wallet.
 * With a session token (email, passkey, or a wallet proven once this session)
 * the nights simply load; without one they say so and offer Verify wallet.
 */
export function useRunNights({
  pool,
  address,
}: {
  pool: PoolInfo;
  address: `0x${string}`;
  /** Ignored: no page load prompts any more. Kept so older call sites
   *  compile; drop it at the call site when next touched. */
  promptForData?: boolean;
}): { nights: ReactNode; tally: Tally | null; line: string | undefined } {
  const requestAuth = cachedOnlyRequester(useWalletAuth());
  const now = useNowSeconds();
  const wearable = evidenceTypeOf(pool.goalSpec) === "wearable";
  const spec = classifyWearableGoal(pool.goalSpec);
  const metric = spec.metric ?? undefined;

  const progressQuery = useQuery({
    queryKey: providerQueryKey(address, pool.id, metric),
    queryFn: () => fetchProviderState(address, requestAuth, pool, metric),
    enabled: wearable,
    retry: false,
  });

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

  const quiet = "m-0 text-[0.9375rem] leading-[1.45] text-muted";
  let nights: ReactNode;
  if (!wearable) {
    nights = (
      <p className={quiet}>
        This challenge is proven with a document, not a wearable, so there is no
        nightly tally. Hand SPOTTER the proof on the challenge page.
      </p>
    );
  } else if (progressQuery.isLoading) {
    nights = (
      <div className="grid gap-2" aria-busy="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-5 w-48" />
      </div>
    );
  } else if (providerDownReason(state) !== null) {
    nights = (
      <p className={quiet}>
        The wearable service is not answering me right now, so I cannot count
        your nights this minute. Nights you already slept still count once it
        is back.
      </p>
    );
  } else if (providerAuthReason(state) !== null) {
    // Verifying re-reads every wallet-gated query, this one included.
    nights = <VerifyWalletAction lead="Your nights are private to your wallet." />;
  } else if (providerMetricUnavailable(state)) {
    nights = (
      <p className="m-0 text-[0.9375rem] font-semibold leading-[1.45] text-foreground">
        Your wearable syncs, and it does not report what this challenge is scored on.
        That is the hardware. Your result settles on what the challenge can read.
      </p>
    );
  } else if (providerAwaitingFirstSync(state)) {
    nights = (
      <p className={quiet}>
        Your wearable is paired and has not sent a night yet. The first sync
        usually lands within minutes. Nothing is counted against you while you
        wait.
      </p>
    );
  } else if (tally !== null) {
    nights = <NightTally tally={tally} />;
  } else {
    nights = <p className={quiet}>No nights counted yet.</p>;
  }

  return { nights, tally, line: tally !== null ? STANDING_LINE[tally.standing] : undefined };
}

export default function RunBoard({
  pool,
  address,
  showLink = false,
  showTitle = true,
}: {
  pool: PoolInfo;
  address: `0x${string}`;
  /** Ignored: no page load prompts any more (see useRunNights). */
  promptForData?: boolean;
  showLink?: boolean;
  /** Off where the page's own heading already names the run. */
  showTitle?: boolean;
}) {
  const now = useNowSeconds();
  const { nights, line } = useRunNights({ pool, address });
  const players = usePlayers(pool.id);
  const selfStaked = pool.bountyModel === 2;
  const feeBps = useCommitmentFee(selfStaked).bps;

  const clock = now === null ? null : runClock(pool.periodStart, pool.periodEnd, now);
  const figure = runFigureOf(clock);

  const playerList = players.data ?? [];
  const hitCount = playerList.filter((p) => p.hit).length;
  // What a hit pays today, from lib/commitment.ts: every other player hitting
  // at the low end, only you at the high end. Before settle only, and only
  // with the player count and the fee both read.
  const recordsMisses = recordsMissesOf(pool);
  const ifYouHit =
    selfStaked && !pool.settled && !pool.cancelled && players.data !== undefined
      ? hitRange(
          { entryFee: pool.entryFee, players: playerList.length, balance: pool.balance, feeBps, recordsMisses },
          false,
        )
      : null;
  const goal = displayGoalSpec(pool.goalSpec);

  return (
    <Card as="article" aria-label={`Challenge: ${goal}`}>
      {showTitle || showLink ? (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3">
          {showTitle ? (
            <h2 className="m-0 min-w-0 break-words text-[1.1875rem] font-semibold leading-snug text-balance">
              {goal}
            </h2>
          ) : null}
          {showLink ? (
            <Link href={`/pools/${pool.id.toString()}`} className={TEXT_LINK}>
              Open this challenge
            </Link>
          ) : null}
        </div>
      ) : null}

      <p className="num m-0 text-[2.75rem] font-bold leading-[0.95] tracking-[-0.03em] min-[900px]:text-[3.5rem]">
        {figure.figure}
      </p>
      <p className="m-0 mt-1 text-sm text-haze">{figure.caption}</p>

      <div className="mt-4">{nights}</div>
      {line !== undefined ? <SpotterCaption line={line} className="mt-4 max-w-md" /> : null}

      <div className="mt-4 border-t border-edge pt-3.5">
        <StatRow>
          <Stat label={selfStaked ? "Your stake" : "Entry"} value={formatUsdc(pool.entryFee)} unit="USDC" tone="money" />
          <Stat label="Pot" value={formatUsdc(pool.balance)} unit="USDC" tone="money" />
          {ifYouHit !== null ? (
            <Stat
              label="If you hit"
              tone="money"
              value={
                ifYouHit.low === ifYouHit.high
                  ? formatUsdc(ifYouHit.low)
                  : `${formatUsdc(ifYouHit.low)} to ${formatUsdc(ifYouHit.high)}`
              }
            />
          ) : (
            <Stat label="Players in" value={players.data !== undefined ? playerList.length : "--"} />
          )}
        </StatRow>
      </div>
      {selfStaked && !pool.settled && !pool.cancelled ? (
        <p className="m-0 mt-3 text-sm leading-[1.45] text-muted">
          {commitmentReminder({
            recordable: recordsMisses,
            players: players.data !== undefined ? playerList.length : null,
          })}
        </p>
      ) : null}

      <section aria-label="Who is in" className="mt-4 border-t border-edge pt-3.5">
        <h3 className="m-0 text-base font-semibold">Who&apos;s in</h3>
        {players.isLoading ? (
          <Skeleton className="mt-3 h-6 w-40" />
        ) : players.isError ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3">
            <p className="m-0 text-sm text-muted">I could not read the players just now.</p>
            <button type="button" onClick={() => void players.refetch()} className={TEXT_LINK}>
              Read them again
            </button>
          </div>
        ) : (
          <>
            <p className="num m-0 mt-0.5 text-sm text-haze">
              {playerList.length} in the challenge, {hitCount} already banked the goal.
            </p>
            <ul className="m-0 mt-2 list-none p-0">
              {playerList.slice(0, 8).map((p) => {
                const you = p.address.toLowerCase() === address.toLowerCase();
                return (
                  <li
                    key={p.address}
                    className="flex min-h-11 items-center justify-between gap-3 border-t border-edge first:border-t-0"
                  >
                    <span className={`min-w-0 truncate text-[0.9375rem] ${you ? "font-semibold" : ""}`}>
                      <EnsName address={p.address} />
                      {you ? <span className="text-haze"> (you)</span> : null}
                    </span>
                    <span className={`shrink-0 text-sm ${p.hit ? "font-semibold text-moonlight" : "text-haze"}`}>
                      {p.hit ? "Hit" : "Still going"}
                    </span>
                  </li>
                );
              })}
              {playerList.length > 8 ? (
                <li className="flex min-h-11 items-center border-t border-edge text-sm text-haze">
                  and {playerList.length - 8} more
                </li>
              ) : null}
            </ul>
          </>
        )}
      </section>
    </Card>
  );
}
