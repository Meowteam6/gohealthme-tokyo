"use client";

// Reads a lane route and reports whether the lane is on for this build, plus
// the parsed answer when it is. See lib/game/lanes.ts for the classification.

import { useQuery } from "@tanstack/react-query";
import { laneAvailabilityFromStatus, type LaneAvailability } from "@/lib/game/lanes";

export interface LaneProbe<T> {
  lane: LaneAvailability | "loading";
  value: T | null;
  refetch: () => void;
}

interface ProbeResult<T> {
  lane: LaneAvailability;
  value: T | null;
}

export function useLaneProbe<T>(
  key: readonly unknown[],
  url: string | null,
  parse: (payload: unknown) => T,
  options: { refetchInterval?: number | false } = {},
): LaneProbe<T> {
  const query = useQuery<ProbeResult<T>>({
    queryKey: ["lane-probe", ...key],
    queryFn: async () => {
      if (url === null) return { lane: "off", value: null };
      try {
        const res = await fetch(url, { cache: "no-store" });
        const lane = laneAvailabilityFromStatus(res.status);
        if (lane !== "on") return { lane, value: null };
        const body = (await res.json().catch(() => null)) as unknown;
        return { lane, value: parse(body) };
      } catch {
        return { lane: "error", value: null };
      }
    },
    enabled: url !== null,
    retry: false,
    staleTime: 30_000,
    refetchInterval: options.refetchInterval ?? false,
  });

  return {
    lane: url === null ? "off" : (query.data?.lane ?? "loading"),
    value: query.data?.value ?? null,
    refetch: () => {
      void query.refetch();
    },
  };
}
