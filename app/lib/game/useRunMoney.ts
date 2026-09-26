"use client";

// The money flow for one live run, from what the browser can read: which flow
// it is, the creator's name, whether a miss can be recorded, and the
// hit-confirmation deadline in the reader's own zone. Feeds
// components/game/MoneyTerms. Reads only; the join, the gate and the money
// paths are untouched.
//
// A challenge run is told apart money first (lib/game/money-sharing
// challengeRunKindOf): the creator's seed at create, which is the pot net of
// every stake and of what backers added (GET /api/pools/[id]/funding), then
// the creator's own stake. Until the seed reads, the kind is null and the
// chips hold their space rather than guess: a stake on yourself that friends
// backed is never shown as a challenge, and a challenge whose challenger
// also joined is never shown as a stake on yourself.

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
      if (pool === null) throw new Error("No run.");
      return fetchParticipant(pool.id, pool.creator);
    },
    enabled: challenge,
    staleTime: 30_000,
  });
  if (!challenge) return null;
  if (query.isError) return false;
  return query.data !== undefined ? query.data.joined : null;
}

/** What backers added to a pool through fundPool, from the server's
 *  PoolFunded scan. Undefined while loading; null when the read failed (the
 *  pot net of stakes then stands in for the seed). */
export function usePoolFundingTotal(
  pool: Pick<PoolInfo, "id"> | null,
  enabled: boolean,
): bigint | null | undefined {
  const query = useQuery({
    queryKey: ["pool-funding", pool?.id.toString() ?? ""],
    queryFn: async (): Promise<bigint> => {
      if (pool === null) throw new Error("No run.");
      const res = await fetch(`/api/pools/${pool.id.toString()}/funding`);
      if (!res.ok) throw new Error(`funding read responded ${res.status}`);
      const body = (await res.json().catch(() => ({}))) as { total?: unknown };
      if (typeof body.total !== "string") throw new Error("funding read had no total");
      return BigInt(body.total);
    },
    enabled: pool !== null && enabled,
    staleTime: 60_000,
    retry: 1,
  });
  if (query.isError) return null;
  return query.data;
}

/** The creator's seed at create: the pot net of every stake and of backers'
 *  money once both read; the pot alone when the funding read failed; null
 *  while either is unread. */
function seedOf(pot: bigint | null, funding: bigint | null | undefined): bigint | null {
  if (pot === null || funding === undefined) return null;
  if (funding === null) return pot;
  const seed = pot - funding;
  return seed < 0n ? 0n : seed;
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
  const funding = usePoolFundingTotal(pool, challenge);
  const names = useDisplayNames(pool !== null ? [pool.creator] : []);
  const now = useNowSeconds();
  if (pool === null) return null;
  const recordable = missRulePool(pool).ok;
  const viewerIsCreator =
    input.viewer !== null && input.viewer.toLowerCase() === pool.creator.toLowerCase();
  const pot =
    players !== null ? sponsorPotOf({ entryFee: pool.entryFee, players, balance: pool.balance }) : null;
  const seed = seedOf(pot, funding);
  // Decided once here, money first, and handed to the flow builder so the
  // chips, the terms and the share card can never disagree.
  const challengeKind =
    challenge && seed !== null && creatorStaked !== null
      ? challengeRunKindOf({ creatorStaked, reward: seed })
      : null;
  const flow = {
    players,
    creatorStaked,
    seed,
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
  const endsOn = now !== null ? momentLabel(Number(pool.periodEnd) * 1000) : undefined;
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
    endsOn,
  });
  return { kind: money.kind, miss: money.miss, copy: money.copy, challengeKind };
}
