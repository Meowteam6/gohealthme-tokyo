"use client";

// The character hook: composes the wallet, the closed-beta allowlist, World's
// proof-of-human, the ENS name and the sensor read into one card, evaluated
// once and shared by every screen. The decisions live in lib/game/character.ts;
// this file only gathers the inputs.
//
// Every read here is cachedOnly or unauthenticated: opening a screen never
// fires a wallet prompt. The one prompting action is checkSensor(), which the
// player taps.

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useAccess } from "@/lib/useAccess";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { useDisplayNames } from "@/lib/use-display-names";
import { useHumanStatus } from "@/lib/world/useHumanStatus";
import {
  fetchProviderOptions,
  providerOptionsQueryKey,
  type ProviderOptions,
} from "@/lib/wearable-connect";
import {
  characterOf,
  characterSteps,
  gatePassed,
  humanModeOf,
  nameModeOf,
  sensorFromOptions,
  type Character,
  type CharacterInputs,
  type HumanMode,
  type HumanStatus,
  type NameMode,
  type SensorRead,
  type StepId,
  type StepState,
} from "@/lib/game/character";
import { parseEnsName } from "@/lib/game/lanes";
import { useLaneProbe } from "@/lib/game/useLaneProbe";

export interface CharacterView {
  ready: boolean;
  authenticated: boolean;
  address: `0x${string}` | null;
  character: Character | null;
  steps: Record<StepId, StepState>;
  gate: boolean;
  /** True while the hard gate is still being evaluated. */
  gateLoading: boolean;
  humanMode: HumanMode;
  nameMode: NameMode;
  worldLane: CharacterInputs["world"]["lane"];
  ensLane: CharacterInputs["ens"]["lane"];
  sensor: SensorRead;
  providers: ProviderOptions | undefined;
  access: ReturnType<typeof useAccess>;
  /** Sign once so the sensor can be read. Resolves true when the player
   *  signed and the re-read landed, false when they declined. */
  checkSensor: () => Promise<boolean>;
  checkingSensor: boolean;
  /** Re-read everything after a step completes. */
  refresh: () => void;
}

export function useCharacter(): CharacterView {
  const { ready, authenticated, address } = useEmbeddedWallet();
  const requestAuth = useWalletAuth();
  const queryClient = useQueryClient();
  const access = useAccess(true);
  const humanHook = useHumanStatus(address);

  const addressParam = address !== null ? encodeURIComponent(address) : null;
  // World's own hook is the source for both answers: whether this wallet is a
  // verified human, and whether prove-human is on for this deployment at all
  // ("off" keeps the closed-beta allowlist, exactly as before V4). A failed
  // read is an error state, never a silent "on".
  const worldLane: CharacterInputs["world"]["lane"] =
    address === null
      ? "off"
      : humanHook.mode === "off"
        ? "off"
        : humanHook.mode === "live" || humanHook.mode === "mock"
          ? "on"
          : humanHook.error
            ? "error"
            : "loading";
  const ensProbe = useLaneProbe(
    ["ens-resolve", address],
    addressParam !== null ? `/api/ens/resolve?address=${addressParam}` : null,
    parseEnsName,
  );
  const { handleFor } = useDisplayNames(address !== null ? [address] : []);

  const sensorQuery = useQuery({
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

  const [checkingSensor, setCheckingSensor] = useState(false);
  const checkSensor = useCallback(async (): Promise<boolean> => {
    setCheckingSensor(true);
    try {
      // The PROMPTING requester, deliberately: the player tapped for this.
      const auth = await requestAuth({ refresh: true });
      if (auth.kind !== "ok") return false;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["wearable-providers"] }),
        queryClient.invalidateQueries({ queryKey: ["wearable-progress"] }),
      ]);
      return true;
    } finally {
      setCheckingSensor(false);
    }
  }, [queryClient, requestAuth]);

  const human: HumanStatus = humanHook.status;

  const inputs: CharacterInputs = {
    ready,
    authenticated,
    address,
    access: {
      status: access.status,
      isAdmin: access.isAdmin,
      loading: access.loading,
      error: access.error,
    },
    world: {
      lane: worldLane,
      human,
    },
    ens: { lane: ensProbe.lane, name: ensProbe.value },
    handle: address !== null ? handleFor(address) : null,
    sensor:
      address === null
        ? { kind: "none" }
        : sensorFromOptions(sensorQuery.data, sensorQuery.isPending),
  };

  const steps = characterSteps(inputs);
  const gate = gatePassed(inputs);
  const gateLoading =
    !ready ||
    (authenticated &&
      !gate &&
      (worldLane === "loading" || (worldLane !== "on" && access.loading)));

  const { refetch: refetchAccess } = access;
  const { refresh: refreshHuman } = humanHook;
  const { refetch: refetchEns } = ensProbe;
  const refresh = useCallback(() => {
    refreshHuman();
    refetchEns();
    refetchAccess();
    void queryClient.invalidateQueries({ queryKey: ["social-resolve"] });
    void queryClient.invalidateQueries({ queryKey: ["wearable-providers"] });
  }, [queryClient, refetchAccess, refreshHuman, refetchEns]);

  const character = characterOf(inputs);

  return {
    ready,
    authenticated,
    address,
    character,
    steps,
    gate,
    gateLoading,
    humanMode: humanModeOf(inputs),
    nameMode: nameModeOf(inputs),
    worldLane,
    ensLane: ensProbe.lane,
    sensor: inputs.sensor,
    providers: sensorQuery.data,
    access,
    checkSensor,
    checkingSensor,
    refresh,
  };
}
