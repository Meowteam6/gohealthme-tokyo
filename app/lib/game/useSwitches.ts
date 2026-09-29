"use client";

// The pre-launch kill switches for this build (GET /api/switches), read once
// and shared through react-query by the join checks, the create forms, the
// chip-in and top-up surfaces, and character creation. The decisions live in
// lib/switches.ts; this only fetches. Never a wallet prompt.

import { useQuery } from "@tanstack/react-query";
import {
  moneyInStateOf,
  parseSwitches,
  type MoneyInState,
  type Switches,
} from "@/lib/switches";

export const SWITCHES_QUERY_KEY = ["kill-switches"] as const;

export async function fetchSwitches(): Promise<Switches> {
  const res = await fetch("/api/switches", { cache: "no-store" });
  if (!res.ok) throw new Error(`switches responded ${res.status}`);
  const parsed = parseSwitches(await res.json().catch(() => null));
  if (parsed === null) throw new Error("switches answered something unusable");
  return parsed;
}

export interface SwitchesView {
  /** Whether new money may go in: open, paused, loading, or the read failed. */
  moneyIn: MoneyInState;
  /** True once the server said World ID is switched off. False while unknown:
   *  the World lane itself (useHumanStatus) decides whether World is on, this
   *  only picks the words for why it is off. */
  worldPaused: boolean;
  /** The operator's note, or null. */
  reason: string | null;
  refetch: () => void;
}

export function useSwitches(): SwitchesView {
  const query = useQuery({
    queryKey: SWITCHES_QUERY_KEY,
    queryFn: fetchSwitches,
    staleTime: 30_000,
    retry: 1,
  });
  return {
    moneyIn: moneyInStateOf({ data: query.data, isError: query.isError }),
    worldPaused: query.data?.worldId === true,
    reason: query.data?.reason ?? null,
    refetch: () => {
      void query.refetch();
    },
  };
}
