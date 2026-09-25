// EVENT MODE ONLY. ETHGlobal Tokyo 2026 mocks World proofs, so when the
// server runs WORLD_VERIFY_MODE=mock the card builds an IDKit-shaped payload
// here instead of opening World App. The server (lib/server/world/verify.ts,
// verifyMock) still checks the action, the wallet binding and the shape, and
// derives the stored nullifier from the one below, so the same mock identity
// on a second wallet is refused with a 409 exactly as a real World ID would
// be. It is NOT a proof of personhood. Every screen that shows it says so.
//
// The shape mirrors IDKitResultV4 + ResponseItemV4 from
// @worldcoin/idkit-core 4.3.0 so the server's parser is the same code path
// in both modes. hashSignal is the SDK's own signal hash (pure JS, no WASM),
// used for the wallet binding exactly as World App would.

import { hashSignal } from "@worldcoin/idkit-core/hashing";

/** The environment string a mocked payload carries; the server refuses
 *  anything else in mock mode and refuses this in live mode. */
export const MOCK_ENVIRONMENT = "mock";

export const MOCK_ACTION_DESCRIPTION =
  "GoHealthMe event mode: mocked proof, not a real World ID verification";

/** Normalise the typed identity so "Andre" and " andre " are one human. */
export function normalizeMockIdentity(identity: string): string {
  return identity.trim().toLowerCase();
}

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export interface MockProofInput {
  address: string;
  identity: string;
  action: string;
  now?: () => number;
}

export function buildMockProof(input: MockProofInput) {
  const identity = normalizeMockIdentity(input.identity);
  if (identity === "") {
    throw new Error("a mock identity is required");
  }
  const now = input.now ?? Date.now;
  return {
    protocol_version: "4.0" as const,
    nonce: randomNonce(),
    action: input.action,
    action_description: MOCK_ACTION_DESCRIPTION,
    environment: MOCK_ENVIRONMENT,
    responses: [
      {
        identifier: "proof_of_human",
        signal_hash: hashSignal(input.address.toLowerCase()),
        // Five zero field elements: the shape of a compressed Groth16 proof
        // plus Merkle root, with nothing in it. Nobody can mistake this for a
        // proof, and the server never forwards it to World in mock mode.
        proof: Array.from({ length: 5 }, () => `0x${"0".repeat(64)}`),
        nullifier: hashSignal(`gohealthme-mock-identity:${identity}`),
        issuer_schema_id: 1,
        expires_at_min: Math.floor(now() / 1000) + 60 * 60,
      },
    ],
  };
}
