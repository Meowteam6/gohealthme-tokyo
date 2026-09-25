// The fresh human verification SPOTTER asks for before it pays.
// World ID for Agents, ETHGlobal Tokyo 2026.
//
// WHY A PROVIDER ABSTRACTION. The prize text says the event supplies its own
// World ID for Agents dev environment and that "we are mocking proofs now, so
// you don't need sandbox app anymore". That environment is not in the public
// docs; Andre confirms it at the World booth on Saturday morning. So the whole
// journey (SPOTTER requests, the human completes, the server validates, the
// protected action runs) is built once against the interface below, and the
// booth answer is a config swap rather than a rewrite:
//
//   WORLD_APPROVAL_MODE=mock   event mode. Deterministic, mocked proofs, and
//                              the UI says so. NOT production: a mocked proof
//                              proves nothing about anybody.
//   WORLD_APPROVAL_MODE=world  live. The browser runs IDKit's request widget
//                              against a server-signed rp_context; the server
//                              re-verifies the returned proof at the World
//                              verify endpoint with the environment pinned
//                              from env (never taken from the client) and a
//                              one-shot nullifier.
//   unset                      the gate is off and SPOTTER pays as before.
//
// WHAT AN APPROVAL MEANS. An approved proof means one human consented to one
// payout: the action string names the goal and the attempt and nothing else.
// It never says the goal was met; that stays with the wearable read and
// SPOTTER's verdict. Nothing here carries health data: the action is a goalId
// hash plus a counter, and the proof is World's own payload forwarded intact.
//
// Sources (fetched 2026-09-26, not from memory): docs.world.org/agents/
// human-in-the-loop/integrate, /api-reference/developer-portal/verify,
// /world-id/idkit/signatures, and the @worldcoin/idkit 4.3.0 type
// declarations. The human-in-the-loop SDK's own tool only runs inside a Vercel
// Workflow DurableAgent; SPOTTER is a ledger state machine with Redis locks and
// a cron sweep, so this module implements the same pattern (action-bound
// signed request, server re-verify, nullifier consumed once) with the
// primitives that SDK itself uses: signRequest and the v4 verify endpoint.

import { createHash } from "crypto";
import { getAddress, isAddress } from "viem";
import { signRequest, type RpSignature } from "@worldcoin/idkit/signing";
import type { RpContext } from "@worldcoin/idkit";
import { optionalEnv, requireEnv } from "@/lib/server/env";

export type ApprovalMode = "off" | "mock" | "world";
export type ApprovalProviderName = Exclude<ApprovalMode, "off">;
export type WorldEnvironment = "production" | "staging" | "sandbox";

/** What the browser needs to run the fresh verification. Nothing in here is
 *  secret: the signing key stays on the server and only its signature over a
 *  nonce and the action travels. */
export interface ApprovalChallenge {
  provider: ApprovalProviderName;
  /** True when the proof the browser will send back is a mocked one. The UI
   *  labels the step "event mode, mocked proofs" off this flag. */
  mocked: boolean;
  world?: {
    appId: `app_${string}`;
    rpContext: RpContext;
    environment: WorldEnvironment;
    allowLegacyProofs: boolean;
  };
}

export type ProviderVerification =
  | { ok: true; nullifier: string }
  | { ok: false; reason: string };

export interface ApprovalProvider {
  readonly name: ApprovalProviderName;
  /** Build the challenge for `action`; ttlSeconds bounds any signed context. */
  challenge(args: {
    action: string;
    ttlSeconds: number;
  }): Promise<ApprovalChallenge>;
  /** Validate what the browser sent back. Server-side, never trusting the
   *  client: a proof for another action, another environment, or one World
   *  rejects is refused with a plain reason. */
  verify(args: {
    action: string;
    address: string;
    proof: unknown;
  }): Promise<ProviderVerification>;
}

/** Reads WORLD_APPROVAL_MODE. Unset is "off" (today's behaviour). A value that
 *  is neither mode is a misconfiguration and throws, so a typo can never
 *  silently turn the human step off. */
export function approvalMode(): ApprovalMode {
  const raw = optionalEnv("WORLD_APPROVAL_MODE", "").toLowerCase();
  if (raw === "") return "off";
  if (raw === "mock" || raw === "world") return raw;
  throw new Error(
    `WORLD_APPROVAL_MODE must be "mock", "world" or unset; got ${JSON.stringify(raw)}`,
  );
}

// --------------------------------------------------------------------- mock

/** The only proof shape the mock provider accepts. The browser builds it; the
 *  server checks it is bound to the action it asked for. It carries no
 *  identity at all, which is the point: it is a stand-in for the event's
 *  mocked proofs and must never be mistaken for one human, one vote. */
export const MOCK_PROOF_KIND = "gohealthme-mock-approval";

export interface MockApprovalProof {
  kind: typeof MOCK_PROOF_KIND;
  action: string;
  approve: true;
}

/**
 * Deterministic stand-in for a World nullifier: the same wallet approving the
 * same action always yields the same value, so the one-shot consumption and
 * the receipt stub behave exactly as they will with real nullifiers. Distinct
 * per action, like the real thing, so a re-ask (new attempt) needs a new one.
 */
export function mockNullifier(address: string, action: string): string {
  const who = isAddress(address) ? getAddress(address) : address;
  return (
    "0x" +
    createHash("sha256")
      .update(`gohealthme-mock-human:${who.toLowerCase()}:${action}`)
      .digest("hex")
  );
}

export function mockApprovalProvider(): ApprovalProvider {
  return {
    name: "mock",
    async challenge() {
      return { provider: "mock", mocked: true };
    },
    async verify({ action, address, proof }) {
      if (typeof proof !== "object" || proof === null) {
        return { ok: false, reason: "no proof was sent" };
      }
      const candidate = proof as Partial<MockApprovalProof>;
      if (candidate.kind !== MOCK_PROOF_KIND) {
        return { ok: false, reason: "that is not a mocked event-mode proof" };
      }
      if (candidate.action !== action) {
        return {
          ok: false,
          reason: "the proof is bound to a different request",
        };
      }
      if (candidate.approve !== true) {
        return { ok: false, reason: "the proof does not approve the payout" };
      }
      return { ok: true, nullifier: mockNullifier(address, action) };
    },
  };
}

// -------------------------------------------------------------------- world

export const DEFAULT_WORLD_VERIFY_URL =
  "https://developer.world.org/api/v4/verify";
export const WORLD_VERIFY_TIMEOUT_MS = 10_000;

export interface WorldProviderConfig {
  rpId: string;
  /** Hex signing key from the Developer Portal, with or without 0x. */
  signingKeyHex: string;
  appId: `app_${string}`;
  environment: WorldEnvironment;
  verifyUrl: string;
  allowLegacyProofs: boolean;
  /** Injection points for tests; production uses the real ones. */
  fetchImpl?: typeof fetch;
  signRequestImpl?: (params: {
    signingKeyHex: string;
    action?: string;
    ttl?: number;
  }) => RpSignature;
}

/** BigInt(nullifier).toString(16), the form the human-in-the-loop docs use for
 *  one-shot tracking; accepts the hex or decimal rendering World returns. */
export function normalizeNullifier(raw: string): string | null {
  try {
    return "0x" + BigInt(raw).toString(16);
  } catch {
    return null;
  }
}

export function worldApprovalProvider(
  config: WorldProviderConfig,
): ApprovalProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const sign = config.signRequestImpl ?? signRequest;
  const signingKeyHex = config.signingKeyHex.replace(/^0x/i, "");
  const verifyUrl = config.verifyUrl.replace(/\/+$/, "");

  return {
    name: "world",
    async challenge({ action, ttlSeconds }) {
      const ttl = Math.max(1, Math.ceil(ttlSeconds));
      const signed = sign({ signingKeyHex, action, ttl });
      return {
        provider: "world",
        mocked: false,
        world: {
          appId: config.appId,
          environment: config.environment,
          allowLegacyProofs: config.allowLegacyProofs,
          rpContext: {
            rp_id: config.rpId,
            nonce: signed.nonce,
            created_at: signed.createdAt,
            expires_at: signed.expiresAt,
            signature: signed.sig,
          },
        },
      };
    },
    async verify({ action, proof }) {
      if (typeof proof !== "object" || proof === null || Array.isArray(proof)) {
        return {
          ok: false,
          reason: "the proof must be the IDKit result object",
        };
      }
      const result = proof as Record<string, unknown>;
      if (result.action !== action) {
        return {
          ok: false,
          reason: "the proof is bound to a different request",
        };
      }
      const responses = result.responses;
      if (!Array.isArray(responses) || responses.length === 0) {
        return {
          ok: false,
          reason: "the proof carries no credential response",
        };
      }

      // Forwarded intact, as the verify reference asks, with ONE change: the
      // environment is pinned from server config. A client that says
      // "production" against a staging relying party gets the staging check.
      const body = { ...result, environment: config.environment };
      let response: Response;
      try {
        response = await fetchImpl(`${verifyUrl}/${config.rpId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(WORLD_VERIFY_TIMEOUT_MS),
        });
      } catch (err) {
        return {
          ok: false,
          reason: `World's verify endpoint could not be reached: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
      const data = (await response.json().catch(() => null)) as {
        success?: unknown;
        code?: unknown;
        nullifier?: unknown;
      } | null;
      if (!response.ok || data === null || data.success !== true) {
        const code =
          data !== null && typeof data.code === "string"
            ? data.code
            : String(response.status);
        return {
          ok: false,
          reason: `World did not accept the proof (${code})`,
        };
      }
      const first = responses[0] as { nullifier?: unknown };
      const raw =
        typeof data.nullifier === "string"
          ? data.nullifier
          : typeof first.nullifier === "string"
            ? first.nullifier
            : null;
      const nullifier = raw === null ? null : normalizeNullifier(raw);
      if (nullifier === null) {
        return {
          ok: false,
          reason: "World accepted the proof but returned no nullifier",
        };
      }
      return { ok: true, nullifier };
    },
  };
}

function worldEnvironmentFromEnv(): WorldEnvironment {
  const raw = optionalEnv("WORLD_ENVIRONMENT", "staging").toLowerCase();
  if (raw === "production" || raw === "staging" || raw === "sandbox") {
    return raw;
  }
  throw new Error(
    `WORLD_ENVIRONMENT must be production, staging or sandbox; got ${JSON.stringify(raw)}`,
  );
}

/** The live provider from env. Throws with the variable name when a piece is
 *  missing: the gate and the routes turn that into an honest "not configured"
 *  state, never a silent fall-back to mock. */
export function worldApprovalProviderFromEnv(): ApprovalProvider {
  const appId = requireEnv("NEXT_PUBLIC_WORLD_APP_ID");
  if (!appId.startsWith("app_")) {
    throw new Error("NEXT_PUBLIC_WORLD_APP_ID must start with app_");
  }
  return worldApprovalProvider({
    rpId: requireEnv("WORLD_RP_ID"),
    signingKeyHex: requireEnv("WORLD_SIGNING_KEY"),
    appId: appId as `app_${string}`,
    environment: worldEnvironmentFromEnv(),
    verifyUrl: optionalEnv("WORLD_VERIFY_URL", DEFAULT_WORLD_VERIFY_URL),
    allowLegacyProofs:
      optionalEnv("WORLD_ALLOW_LEGACY_PROOFS", "false") === "true",
  });
}

/** The provider for a mode that is on. Callers resolve the mode first so an
 *  "off" deployment never constructs anything. */
export function approvalProviderFor(
  mode: ApprovalProviderName,
): ApprovalProvider {
  return mode === "mock"
    ? mockApprovalProvider()
    : worldApprovalProviderFromEnv();
}
