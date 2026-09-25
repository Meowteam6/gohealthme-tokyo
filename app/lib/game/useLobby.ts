"use client";

// The lobby's reads, gathered once: every pool, which ones this wallet is in,
// the provider state and the device capability (cachedOnly, so browsing never
// opens a wallet prompt), and the character. The decision is buildLobby in
// lib/game/lobby.ts.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchParticipant,
  fetchPools,
  type ParticipantInfo,
  type PoolInfo,
} from "@/lib/contract";
import { useWalletAuth } from "@/lib/useWalletAuth";
import {
  fetchProviderState,
  providerDownReason,
  providerQueryKey,
} from "@/lib/wearable-provider";
import {
  capabilityNeedsDevice,
  capabilityUnknown,
  fetchProviderOptions,
  providerOptionsQueryKey,
  viewerMetricsOf,
} from "@/lib/wearable-connect";
import { buildLobby, type Lobby } from "@/lib/game/lobby";
import type { CharacterView } from "@/lib/game/useCharacter";
import { useJoinChecks } from "@/lib/game/useJoinChecks";

export interface MyRun {
  pool: PoolInfo;
  participant: ParticipantInfo;
}

/** Every pool this wallet has entered, read from the chain. */
export async function fetchMyRuns(address: `0x${string}`): Promise<MyRun[]> {
  const pools = await fetchPools();
  const participants = await Promise.all(
    pools.map((pool) => fetchParticipant(pool.id, address)),
  );
  return pools
    .map((pool, i) => ({ pool, participant: participants[i] }))
    .filter((entry) => entry.participant.joined);
}

export const MY_RUNS_KEY = "joined-pools";

export function useMyRuns(address: `0x${string}` | null) {
  return useQuery({
    queryKey: [MY_RUNS_KEY, address],
    queryFn: () => {
      if (address === null) throw new Error("No wallet connected.");
      return fetchMyRuns(address);
    },
    enabled: address !== null,
  });
}

export interface LobbyView {
  lobby: Lobby | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
  /** The provider is refusing SPOTTER: every wearable run is locked. */
  outage: boolean;
  deviceLabel: string | null;
  /** Read the join checks again (the "Check again" fix on a locked run). */
  retryChecks: () => void;
}

export function useLobby(view: CharacterView, highlightId: string | null): LobbyView {
  const { address } = view;
  const requestAuth = useWalletAuth();
  const checks = useJoinChecks(view);

  const poolsQuery = useQuery({
    queryKey: ["pools"],
    queryFn: async () => ({
      pools: await fetchPools(),
      asOfSeconds: BigInt(Math.floor(Date.now() / 1000)),
    }),
    refetchInterval: 45_000,
  });

  const myRuns = useMyRuns(address);

  const providerQuery = useQuery({
    queryKey: providerQueryKey(address),
    queryFn: () => {
      if (address === null) throw new Error("No wallet connected.");
      return fetchProviderState(address, (options) =>
        requestAuth({ ...options, cachedOnly: true }),
      );
    },
    enabled: address !== null,
    retry: false,
  });

  const capabilityQuery = useQuery({
    queryKey: providerOptionsQueryKey(address),
    queryFn: () => {
      if (address === null) throw new Error("No wallet connected.");
      return fetchProviderOptions(address, (options) =>
        requestAuth({ ...options, cachedOnly: true }),
      );
    },
    enabled: address !== null,
    retry: false,
    staleTime: 60_000,
  });

  const providerDown = providerDownReason(providerQuery.data);
  const viewerMetrics = viewerMetricsOf(capabilityQuery.data);
  const deviceLabel =
    (capabilityQuery.data?.providers ?? []).find(
      (p) => p.id === capabilityQuery.data?.selected,
    )?.label ?? null;
  const joinedIds = useMemo(
    () => new Set((myRuns.data ?? []).map((r) => r.pool.id.toString())),
    [myRuns.data],
  );

  const lobby =
    poolsQuery.data === undefined
      ? null
      : buildLobby({
          pools: poolsQuery.data.pools,
          asOfSeconds: poolsQuery.data.asOfSeconds,
          verifier: checks.verifier,
          payouts: checks.payouts,
          gate: checks.gate,
          joined: joinedIds,
          highlightId,
          address,
          providerDown,
          viewerMetrics,
          capabilityPending: address !== null && capabilityUnknown(capabilityQuery.data),
          needsDevice: capabilityNeedsDevice(capabilityQuery.data),
          worldLane: checks.worldLane,
          humanVerified: checks.humanVerified,
          deviceLabel,
        });

  return {
    lobby,
    // Wait for the joined read too, or a run the player is in would flash
    // as enterable first.
    // The document checker and the payout rule too: they decide whether
    // upload runs show at all and whether any run can take a stake.
    loading:
      poolsQuery.isLoading ||
      (address !== null && myRuns.isLoading) ||
      checks.verifier === "loading" ||
      checks.payouts === "loading",
    // A failed joined-runs read is an error too: every run would otherwise
    // look un-entered and offer a join that reverts ALREADY_JOINED.
    error: poolsQuery.isError || (address !== null && myRuns.isError),
    retry: () => {
      void poolsQuery.refetch();
      if (address !== null) void myRuns.refetch();
    },
    outage: providerDown !== null,
    deviceLabel,
    retryChecks: checks.retry,
  };
}
