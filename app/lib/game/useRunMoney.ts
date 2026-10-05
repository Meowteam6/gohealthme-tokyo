"use client";

// The money flow for one live run, from what the browser can read: which flow
// it is, the creator's name, whether a miss can be recorded, and the
// hit-confirmation deadline in the reader's own zone. Feeds
// components/game/MoneyTerms. Reads only; the join, the gate and the money
// paths are untouched.
//
// A challenge is told apart by the creator's own stake (lib/game/money-sharing
// challengeRunKindOf). Until it reads, the kind is null and the chips hold
// their space rather than guess.

import { useQuery } from "@tanstack/react-query";
import type { MissChip } from "@/lib/commitment-copy";
import { fetchParticipant, type PoolInfo } from "@/lib/contract";
import { sponsorPotOf } from "@/lib/game/commitment-copy";
import { momentLabel, runMoneyOf, type FlowKind, type MoneyCopy } from "@/lib/game/money-flow";
import { challengeRunKindOf, type ChallengeRunKind } from "@/lib/game/money-sharing";
import { useNowSeconds } from "@/lib/game/useNowSeconds";
import { missConfirmByMs } from "@/lib/miss-grace";
import { missRulePool } from "@/lib/miss-rule";
import { useDisplayNames } from "@/lib/use-display-names";

export interface LiveRunMoney {
  /** Null on a challenge whose flow has not read yet (the seed, the creator's
   *  stake); every other run's kind is known from the pool alone. */
  kind: FlowKind | null;
  /** Null while the player count has not read. */
  miss: MissChip | null;
  /** Null while the player count has not read. */
  copy: MoneyCopy | null;
  /** Which challenge flow this run is (lib/game/money-sharing); null on any
   *  other run, and on a challenge while unread. */
  challengeKind: ChallengeRunKind | null;
}

function isChallenge(pool: Pick<PoolInfo, "initiative" | "bountyModel"> | null): boolean {
  return pool !== null && pool.initiative === "challenge" && pool.bountyModel === 2;
}

/** Whether a challenge's creator staked in it. Null while unread, and for any
 *  run that is not a challenge (it never matters). A read that failed counts
 *  as not staked: money tells the flow first, and the stake-on-yourself chips
 *  read the same either way. */
export function useCreatorStaked(
  pool: Pick<PoolInfo, "id" | "creator" | "initiative" | "bountyModel"> | null,
): boolean | null {
  const challenge = isChallenge(pool);
  const query = useQuery({
    queryKey: ["participant", pool?.id.toString() ?? "", pool?.creator ?? ""],
    queryFn: () => {
      if (pool === null) throw new Error("No challenge.");
      return fetchParticipant(pool.id, pool.creator);
    },
    enabled: challenge,
    staleTime: 30_000,
  });
  if (!challenge) return null;
  if (query.isError) return false;
  return query.data !== undefined ? query.data.joined : null;
}

export function useRunMoney(input: {
  /** Null while the run has not read: the hook still runs, so a page can
   *  call it before its early returns. */
  pool: PoolInfo | null;
  /** participantCount; null while unread. */
  players: number | null;
  /** The reader is about to stake (not yet in). */
  includeJoiner: boolean;
  /** The signed-in wallet, to tell the creator reading their own run. */
  viewer: string | null;
  /** commitmentFeeBps; null states no range. */
  feeBps: number | null;
}): LiveRunMoney | null {
  const { pool, players } = input;
  const challenge = isChallenge(pool);
  const creatorStaked = useCreatorStaked(pool);
  const names = useDisplayNames(pool !== null ? [pool.creator] : []);
  const now = useNowSeconds();
  if (pool === null) return null;
  const recordable = missRulePool(pool).ok;
  const viewerIsCreator =
    input.viewer !== null && input.viewer.toLowerCase() === pool.creator.toLowerCase();
  const pot =
    players !== null ? sponsorPotOf({ entryFee: pool.entryFee, players, balance: pool.balance }) : null;
  // Decided once here and handed to the flow builder so the chips, the terms
  // and the share card can never disagree.
  const challengeKind =
    challenge && creatorStaked !== null ? challengeRunKindOf({ creatorStaked }) : null;
  const flow = {
    players,
    creatorStaked,
    kind: challengeKind ?? undefined,
    creatorName: names.displayName(pool.creator),
    viewerIsCreator,
  };
  if (players === null || (challenge && challengeKind === null)) {
    const money = runMoneyOf({
      pool,
      flow,
      numbers: {
        entryFee: pool.entryFee,
        players: 0,
        pot: 0n,
        feeBps: null,
        recordable,
        includeJoiner: input.includeJoiner,
        confirmBy: null,
      },
    });
    return { kind: challenge ? null : money.kind, miss: null, copy: null, challengeKind: null };
  }
  // Dates render after mount: the server's zone is not the reader's.
  const confirmBy = now !== null && recordable ? momentLabel(missConfirmByMs(pool.periodEnd)) : null;
  const money = runMoneyOf({
    pool,
    flow,
    numbers: {
      entryFee: pool.entryFee,
      players,
      pot: pot ?? 0n,
      feeBps: input.feeBps,
      recordable,
      includeJoiner: input.includeJoiner,
      confirmBy,
    },
  });
  return { kind: money.kind, miss: money.miss, copy: money.copy, challengeKind };
}
