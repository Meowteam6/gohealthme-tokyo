// Server-only env access. Every module reads env through these helpers so a
// missing variable fails loudly with the variable name instead of a cryptic
// downstream error. These messages are for the SERVER LOG: routes hand the
// client safeError (lib/server/http.ts), never the thrown text.

import { FROZEN_V3_POOLS_ADDRESS, isFrozenV3Pools } from "../frozen-pools";

export { FROZEN_V3_POOLS_ADDRESS, isFrozenV3Pools };

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required env var ${name}. Add it to the repo-root .env (see .env.example).`,
    );
  }
  return value.trim();
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return value.trim();
}

/** True on the Vercel production deployment, the one real beta users hit.
 *  Every mock switch in this app is refused when this is true. */
export function isProductionDeployment(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * DEMO_MODE turns a missing or failing document attester into a MOCKED
 * verified=true verdict. It exists for tests, local runs and preview
 * deployments only. On production it is refused (fail closed: documents are
 * verified by the real attester or not at all) and the refusal is logged each
 * time it is consulted, so a stray env var is loud, never silent.
 */
export function demoModeEnabled(): boolean {
  const value = optionalEnv("DEMO_MODE", "").toLowerCase();
  const asked = value === "true" || value === "1";
  if (!asked) return false;
  if (isProductionDeployment()) {
    console.error(
      "[env] DEMO_MODE is set on a production deployment and is REFUSED: mocked verdicts never reach real users. Remove DEMO_MODE from the production env.",
    );
    return false;
  }
  return true;
}

/** Thrown when this deployment is pointed at the frozen V3 pilot pools. */
export class FrozenPoolsError extends Error {
  constructor(name: string) {
    super(
      `${name} is the frozen V3 pilot HealthPools (${FROZEN_V3_POOLS_ADDRESS}). ` +
        "V4 must never read, record or settle against V3 users' challenges. Deploy the Tokyo " +
        "HealthPoolsV3 (scripts/tokyo-deploy.sh) and point HEALTH_POOLS_ADDRESS, " +
        "NEXT_PUBLIC_HEALTH_POOLS_ADDRESS and HEALTH_POOLS_FROM_BLOCK at it.",
    );
    this.name = "FrozenPoolsError";
  }
}

/**
 * The HealthPools contract SPOTTER records, settles and reads against. Every
 * server money path resolves it here, so a deployment accidentally left on the
 * V3 pilot address refuses to start SPOTTER or settle anything (fail closed,
 * loud) instead of acting on another product's real users. A malformed value
 * throws too, rather than reaching viem as a cryptic encoding error.
 */
export function requireHealthPoolsAddress(): `0x${string}` {
  const value = requireEnv("HEALTH_POOLS_ADDRESS");
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error("HEALTH_POOLS_ADDRESS is not a 0x address.");
  }
  if (isFrozenV3Pools(value)) throw new FrozenPoolsError("HEALTH_POOLS_ADDRESS");
  return value as `0x${string}`;
}
