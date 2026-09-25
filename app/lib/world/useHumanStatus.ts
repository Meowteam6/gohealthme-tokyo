"use client";

// Lane contract (docs/LANES.md): read-only view of whether a wallet has proven it is one human.
// Backed by GET /api/world/status?address=. The world-idkit lane replaces this file wholesale.

export type HumanStatus = "unknown" | "verified" | "unverified";

export interface HumanStatusView {
  status: HumanStatus;
  loading: boolean;
  refresh: () => void;
}

export function useHumanStatus(_address: string | null): HumanStatusView {
  return { status: "unknown", loading: false, refresh: () => undefined };
}
