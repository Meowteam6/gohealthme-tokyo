// The two verifiers behind POST /api/world/verify, and the checks they share.
//
// SHARED CHECKS (both modes, before anything else):
//   action   The proof must be for THIS app's action. In live mode World's
//            own verify would reject a mismatch too, but checking here keeps
//            the error plain and keeps the mock path honest.
//   signal   The widget is asked for a proof over signal = the wallet address
//            (lowercased). World hashes the signal into responses[0].signal_hash
//            (hashSignal from @worldcoin/idkit-core/hashing). If it does not
//            match the wallet that signed this request, the proof was made for
//            somebody else and is refused. A payload with no signal_hash fails
//            closed for the same reason: a proof that is not bound to a wallet
//            could be replayed against any wallet.
//
// LIVE: the untouched IDKit payload is forwarded as-is to
//   POST https://developer.world.org/api/v4/verify/{rp_id}
// per docs.world.org/world-id/idkit/integrate (read 2026-09-26). The response's
// nullifier is canonicalised and returned. World's error codes are mapped to
// plain sentences; the code is kept for the log.
//
// MOCK (event mode): ETHGlobal Tokyo 2026 mocks proofs. World is NOT called.
// The payload must carry environment "mock" (a real staging or production
// proof posted to a mock deployment is refused, so the two modes can never be
// confused), and the nullifier is derived deterministically from the
// payload's nullifier and the action. The same mock identity always maps to
// the same nullifier, which is what lets the demo show the denied path: one
// identity, two wallets, second one refused. THIS IS NOT A PROOF OF
// PERSONHOOD and must never run outside the event build.

import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { keccak256, stringToBytes } from "viem";
import type { LiveConfig } from "@/lib/server/world/config";
import { normalizeNullifier } from "@/lib/server/world/nullifier";
import type { ParsedProof, ProtocolVersion } from "@/lib/server/world/payload";

export const WORLD_VERIFY_URL = "https://developer.world.org/api/v4/verify";

/** Environment string the mock payload must carry. */
export const MOCK_ENVIRONMENT = "mock";

export type VerifyResult =
  | { ok: true; nullifierHash: string; protocolVersion: ProtocolVersion }
  | {
      ok: false;
      /** 401: the proof did not check out. 502: World could not be reached
       *  or answered nonsense; the proof may be fine, try again. */
      status: 401 | 502;
      reason: string;
      /** World's own error code when it gave one, for the server log. */
      code?: string;
    };

/** The signal the widget must be asked for, and the server checks against. */
export function walletSignal(address: string): string {
  return address.toLowerCase();
}

/** What responses[0].signal_hash must equal for `address`. */
export function expectedSignalHash(address: string): string {
  return hashSignal(walletSignal(address)).toLowerCase();
}

function sharedChecks(
  proof: ParsedProof,
  address: string,
  action: string,
): VerifyResult | null {
  if (proof.action !== action) {
    return {
      ok: false,
      status: 401,
      reason:
        "That proof was made for a different action. Start the World ID step again from this page.",
    };
  }
  if (proof.signalHash === null) {
    return {
      ok: false,
      status: 401,
      reason:
        "That proof is not bound to a wallet, so it cannot be accepted. Start the World ID step again from this page.",
    };
  }
  if (proof.signalHash.toLowerCase() !== expectedSignalHash(address)) {
    return {
      ok: false,
      status: 401,
      reason:
        "That proof was made for a different wallet. Sign in with the wallet you verified with, or verify again with this one.",
    };
  }
  return null;
}

// --------------------------------------------------------------------- live

interface WorldVerifyResponse {
  success?: boolean;
  nullifier?: string;
  environment?: string;
  code?: string;
  detail?: string;
  results?: Array<{ success?: boolean; nullifier?: string; detail?: string }>;
}

function plainWorldError(
  code: string | undefined,
  detail: string | undefined,
): string {
  switch (code) {
    case "max_verifications_reached":
      return "This World ID has already been used for this action.";
    case "all_verifications_failed":
    case "verification_error":
      return "World could not verify that proof. Try the World ID step again.";
    case "app_not_migrated":
      return "This app is not set up for World ID 4.0 in the Developer Portal.";
    default:
      return detail !== undefined && detail !== ""
        ? `World rejected the proof: ${detail}`
        : "World rejected the proof.";
  }
}

export async function verifyLive(params: {
  proof: ParsedProof;
  address: string;
  config: LiveConfig;
  fetchImpl?: typeof fetch;
}): Promise<VerifyResult> {
  const { proof, address, config } = params;
  const fetchImpl = params.fetchImpl ?? fetch;

  const shared = sharedChecks(proof, address, config.action);
  if (shared !== null) return shared;

  if (proof.environment !== config.environment) {
    return {
      ok: false,
      status: 401,
      reason: `That proof came from World's ${proof.environment || "unknown"} environment; this deployment verifies against ${config.environment}.`,
    };
  }

  let res: Response;
  try {
    res = await fetchImpl(`${WORLD_VERIFY_URL}/${config.rpId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(proof.raw),
    });
  } catch (err) {
    console.error("[world] verify request failed", err);
    return {
      ok: false,
      status: 502,
      reason:
        "Could not reach World to check the proof. Nothing was recorded; try again.",
    };
  }

  let data: WorldVerifyResponse;
  try {
    data = (await res.json()) as WorldVerifyResponse;
  } catch {
    return {
      ok: false,
      status: 502,
      reason: `World answered with something this app could not read (HTTP ${res.status}). Try again.`,
    };
  }

  if (!res.ok || data.success !== true) {
    console.error(
      `[world] verify rejected (HTTP ${res.status}) code=${data.code ?? "?"} detail=${data.detail ?? ""}`,
    );
    return {
      ok: false,
      status: 401,
      reason: plainWorldError(data.code, data.detail),
      code: data.code,
    };
  }

  if (
    data.environment !== undefined &&
    data.environment !== config.environment
  ) {
    return {
      ok: false,
      status: 401,
      reason: `World verified that proof in its ${data.environment} environment; this deployment expects ${config.environment}.`,
    };
  }

  const returned =
    data.nullifier ??
    data.results?.find((r) => r.success === true)?.nullifier ??
    proof.nullifier;
  const nullifierHash = normalizeNullifier(returned);
  if (nullifierHash === null) {
    return {
      ok: false,
      status: 502,
      reason:
        "World verified the proof but returned no usable nullifier. Try again.",
    };
  }
  return { ok: true, nullifierHash, protocolVersion: proof.protocolVersion };
}

// --------------------------------------------------------------------- mock

/** Deterministic nullifier for a mocked proof. Same identity, same action,
 *  same nullifier, every time; that is the whole point of the mock. */
export function mockNullifier(action: string, inputNullifier: string): string {
  return keccak256(
    stringToBytes(`gohealthme-mock-proof:${action}:${inputNullifier}`),
  );
}

export function verifyMock(params: {
  proof: ParsedProof;
  address: string;
  action: string;
}): VerifyResult {
  const { proof, address, action } = params;

  const shared = sharedChecks(proof, address, action);
  if (shared !== null) return shared;

  if (proof.environment !== MOCK_ENVIRONMENT) {
    return {
      ok: false,
      status: 401,
      reason: `This deployment is in event mode and only accepts mocked proofs; that one came from World's ${proof.environment || "unknown"} environment.`,
    };
  }
  if (proof.identifier !== "proof_of_human") {
    return {
      ok: false,
      status: 401,
      reason: "Event mode accepts proof_of_human mock payloads only.",
    };
  }
  const input = normalizeNullifier(proof.nullifier);
  if (input === null) {
    return {
      ok: false,
      status: 401,
      reason: "The mock payload's nullifier is not a valid field element.",
    };
  }
  return {
    ok: true,
    nullifierHash: mockNullifier(action, input),
    protocolVersion: proof.protocolVersion,
  };
}
