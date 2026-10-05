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
// resolves to "off" WITH a problem string. The problem string is OPERATOR
// detail (it names env vars): routes log it and hand the player
// PLAYER_WORLD_PROBLEM instead, so a misconfigured deployment fails closed,
// visibly, without printing configuration to a stranger.
//
// KILL SWITCH (Andre, 2026-09-30). KILL_WORLD_ID=1 (lib/server/kill-switches)
// turns a working World setup off, marked `paused`, so every reader follows:
// verify refuses new proofs, rp-context reports off, the lobby shows the list
// path, requireHuman() stands down and the payout confirmation is off
// (approval-provider.ts). Bindings World already made keep counting through
// boundWorldNamespace() (access.ts), so a verified player keeps their way in.
//
// Production refusals (VERCEL_ENV=production, fail closed to "off"):
//   - WORLD_VERIFY_MODE=mock (typed identities are not people)
//   - live with WORLD_ENVIRONMENT anything but "production": staging proofs
//     come from the public simulator, which mints unlimited identities.
//
// NAMESPACES. Human records are stored per namespace (human.ts): "mock",
// "live-staging" or "live-production". A binding made in one namespace never
// satisfies a read in another, so a mocked identity typed on a preview that
// shares the store with production can never count as a real human there.

import { isProductionDeployment, optionalEnv } from "@/lib/server/env";
import { killSwitches } from "@/lib/server/kill-switches";

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
  /** True when a working setup is switched off by KILL_WORLD_ID. Absent
   *  otherwise. */
  paused?: true;
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

export { isProductionDeployment };

/** Where a World human record lives. See the header. */
export type WorldNamespace = "mock" | "live-staging" | "live-production";

export function namespaceFor(
  mode: Exclude<WorldMode, "off">,
  environment: WorldEnvironment,
): WorldNamespace {
  return mode === "mock" ? "mock" : `live-${environment}`;
}

/** The namespace this deployment reads and writes, or null when prove-human
 *  is off (nothing is enforced, so no record is consulted). */
export function worldNamespace(setup: WorldSetup = worldSetup()): WorldNamespace | null {
  if (setup.mode === "off") return null;
  if (setup.mode === "mock") return "mock";
  return namespaceFor("live", setup.live?.environment ?? worldEnvironment());
}

/**
 * The namespace the bindings World already made live in, even while
 * KILL_WORLD_ID pauses new proofs. Access keeps honouring those bindings
 * (lib/server/access.ts), so a World-verified player keeps their gate, their
 * challenge pages, withdraw and refund. Null when World is not configured at
 * all (unset, misconfigured or refused), exactly as worldNamespace() then.
 */
export function boundWorldNamespace(): WorldNamespace | null {
  return worldNamespace(configuredWorldSetup());
}

/** What a player sees when prove-human is off because of a misconfiguration.
 *  The operator detail (setup.problem) goes to the server log only. */
export const PLAYER_WORLD_PROBLEM =
  "Proving you're one human is paused on this build while we fix its setup. Nothing was recorded. Check back soon.";

/** What a player sees when prove-human is simply not switched on. */
export const PLAYER_WORLD_OFF =
  "Proving you're one human is not switched on for this build, so the closed-beta list decides who plays.";

/** What a player sees while World ID is switched off by the operator. */
export const PLAYER_WORLD_PAUSED =
  "Proving you're one human with World ID is paused for now. Nothing was recorded. The closed-beta list is the way in meanwhile.";

/** The operator-side problem string for a deliberate pause. No env detail
 *  reaches a player either way (playerWorldProblem maps it). */
export const WORLD_PAUSED_PROBLEM = "World ID is switched off by the kill switch. Prove-human is off.";

/** The player-safe line for an "off" setup; logs the operator detail. A
 *  deliberate pause is not an error and logs nothing. */
export function playerWorldProblem(setup: WorldSetup, correlationId: string): string {
  if (setup.paused === true) return PLAYER_WORLD_PAUSED;
  if (setup.problem === null) return PLAYER_WORLD_OFF;
  console.error(`[${correlationId}] world config: ${setup.problem}`);
  return PLAYER_WORLD_PROBLEM;
}

/**
 * The World setup every reader follows: the configured one, switched off
 * (paused) while KILL_WORLD_ID is thrown. A build without World configured is
 * unchanged by the switch: it was already off.
 */
export function worldSetup(): WorldSetup {
  const configured = configuredWorldSetup();
  if (configured.mode === "off" || !killSwitches().worldId) return configured;
  return {
    mode: "off",
    action: configured.action,
    problem: WORLD_PAUSED_PROBLEM,
    live: null,
    paused: true,
  };
}

/** The setup the env configures, before the kill switch. Only
 *  boundWorldNamespace() reads it directly. */
function configuredWorldSetup(): WorldSetup {
  const action = worldAction();
  const raw = optionalEnv("WORLD_VERIFY_MODE", "").toLowerCase();

  if (raw === "") return { mode: "off", action, problem: null, live: null };

  if (raw === "mock") {
    // Hard rule (2026-09-26): V4 serves real beta users, so a production
    // deployment never runs on typed identities. Mock stays for tests, local
    // runs and preview deployments.
    if (isProductionDeployment()) {
      return {
        mode: "off",
        action,
        problem:
          "WORLD_VERIFY_MODE=mock is refused on a production deployment. Set live.",
        live: null,
      };
    }
    return { mode: "mock", action, problem: null, live: null };
  }

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

  const environment = worldEnvironment();
  if (isProductionDeployment() && environment !== "production") {
    // Staging proofs come from simulator.worldcoin.org, which mints any
    // number of identities. On the deployment real beta users hit that is a
    // mock by another name, so it is refused the same way (fail closed).
    return {
      mode: "off",
      action,
      problem:
        "WORLD_ENVIRONMENT must be production on a production deployment (staging proofs come from the simulator). Prove-human is off.",
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
      environment,
    },
  };
}

/** True when a proof-of-human is enforced on this deployment. */
export function worldEnabled(): boolean {
  return worldSetup().mode !== "off";
}
