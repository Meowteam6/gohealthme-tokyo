// The V3 pilot's HealthPoolsV3 on Base Sepolia. It is frozen for the Tokyo
// weekend and belongs to another product's real pilot users: V4 must never
// join, fund, record, settle or even display activity against it. Shared by
// the server guard (lib/server/env.ts requireHealthPoolsAddress) and the
// browser read (lib/contract.ts getHealthPoolsAddress), so both sides refuse
// the same address.

export const FROZEN_V3_POOLS_ADDRESS =
  "0x66815e3AC541eB18d01D2aed25D0D9779583D832";

export function isFrozenV3Pools(address: string): boolean {
  return address.trim().toLowerCase() === FROZEN_V3_POOLS_ADDRESS.toLowerCase();
}
