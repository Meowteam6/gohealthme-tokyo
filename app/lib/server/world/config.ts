// World ID (IDKit) server configuration. Three modes, chosen by WORLD_VERIFY_MODE:
//
//   live   Proofs are verified against World's cloud verify API
//          (POST https://developer.world.org/api/v4/verify/{rp_id}). Needs
//          WORLD_APP_ID, WORLD_RP_ID and WORLD_RP_SIGNING_KEY from the
//          Developer Portal. WORLD_ENVIRONMENT picks staging (the simulator at
//          simulator.worldcoin.org) or production.
//   mock   EVENT MODE. ETHGlobal Tokyo 2026 mocks World proofs, so this mode
//          accepts an IDKit-shaped payload, checks its wallet binding, and
//          derives a deterministic nullifier from it WITHOUT calling World.
//          Nothing about it is a real identity check. Every surface that
//          shows a mocked result says so. Never set it on a deployment with
//          real users.
//   unset  Prove-human is not enabled on this deployment. The routes report
//          that honestly, requireHuman() is a no-op, and access control keeps
//          the closed-beta allowlist behaviour, so nobody hits a new dead end.
//
// A "live" that is missing a required variable, or an unrecognised value,
// resolves to "off" WITH a problem string. That string is returned by the
// rp-context route and rendered by ProveHuman, so a misconfigured deployment
// says what is wrong instead of failing every verification with a 500.

import { optionalEnv } from "@/lib/server/env";

export type WorldMode = "live" | "mock" | "off";
export type WorldEnvironment = "staging" | "production";

export interface LiveConfig {
  appId: `app_${string}`;
  rpId: string;
  signingKeyHex: string;
  action: string;
  environment: WorldEnvironment;
}

export interface WorldSetup {
  mode: WorldMode;
  /** The action string every proof must be made for. Same in every mode. */
  action: string;
  /** Non-null when the configured mode could not be honoured. */
  problem: string | null;
  /** Populated only in live mode. */
  live: LiveConfig | null;
}

/** Default incognito action. One action for the whole app: one nullifier per
 *  human, which is what "one human, one wallet" needs. Per-pool actions would
 *  give one human a fresh nullifier per pool and defeat the wallet binding. */
export const DEFAULT_WORLD_ACTION = "prove-human";

export function worldAction(): string {
  return optionalEnv("WORLD_ACTION", DEFAULT_WORLD_ACTION);
}

export function worldEnvironment(): WorldEnvironment {
  return optionalEnv("WORLD_ENVIRONMENT", "staging") === "production"
    ? "production"
    : "staging";
}

export function worldSetup(): WorldSetup {
  const action = worldAction();
  const raw = optionalEnv("WORLD_VERIFY_MODE", "").toLowerCase();

  if (raw === "") return { mode: "off", action, problem: null, live: null };

  if (raw === "mock") return { mode: "mock", action, problem: null, live: null };

  if (raw !== "live") {
    return {
      mode: "off",
      action,
      problem: `WORLD_VERIFY_MODE is "${raw}"; expected live or mock. Prove-human is off.`,
      live: null,
    };
  }

  const appId = optionalEnv("WORLD_APP_ID", "");
  const rpId = optionalEnv("WORLD_RP_ID", "");
  const signingKeyHex = optionalEnv("WORLD_RP_SIGNING_KEY", "");
  const missing: string[] = [];
  if (!appId.startsWith("app_")) missing.push("WORLD_APP_ID (app_...)");
  if (rpId === "") missing.push("WORLD_RP_ID");
  if (signingKeyHex === "") missing.push("WORLD_RP_SIGNING_KEY");
  if (missing.length > 0) {
    return {
      mode: "off",
      action,
      problem: `WORLD_VERIFY_MODE=live but ${missing.join(", ")} is not set. Prove-human is off.`,
      live: null,
    };
  }

  return {
    mode: "live",
    action,
    problem: null,
    live: {
      appId: appId as `app_${string}`,
      rpId,
      signingKeyHex,
      action,
      environment: worldEnvironment(),
    },
  };
}

/** True when a proof-of-human is enforced on this deployment. */
export function worldEnabled(): boolean {
  return worldSetup().mode !== "off";
}
