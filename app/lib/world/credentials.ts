// The one World ID credential policy, shared by prove-human
// (components/world/IdkitWidgetHost.tsx) and SPOTTER's payout confirmation
// (components/world/WorldApprovalWidget.tsx), plus the server's reading of
// which credential a verified proof used.
//
// FOUNDER DECISION (Andre, 2026-09-26): World must not require an Orb. Anyone
// with World App gets through; the strongest credential they hold is used.
// The tradeoff is written up in docs/WORLD.md ("Credentials").
//
// HOW "ANY ONE OF" IS REQUESTED, and why it takes two stages. Sources, read
// 2026-09-26, not from memory:
//   - @worldcoin/idkit-core 4.3.0 dist/index.d.ts: CredentialType is
//     "proof_of_human" | "selfie" | "passport" | "mnc"; `any(...)` is "at
//     least one child must be satisfied"; IDKitRequestWidget takes either
//     `preset` or `constraints`, never both.
//   - docs.world.org/world-id/idkit/credentials: proofOfHuman = Orb, passport
//     = NFC passport, Selfie Check "Anyone with World ID App can complete the
//     flow, no Orb or document credential is required" (credentials/11: "No
//     Orb, passport or other prerequisite credential is required");
//     documentLegacy/deviceLegacy are 3.0-only and return "the user's highest
//     legacy credential".
//   - github.com/worldcoin/idkit rust/core/src/wasm_bindings.rs (to_params):
//     a raw `.constraints()` request sends its World ID 3.0 fallback at Device
//     level with legacy_signal = "" (empty). A 3.0 fallback proof from a
//     constraint request is therefore NOT bound to our signal, and the server
//     must refuse it. Only a preset carries the signal into the 3.0 proof
//     (rust/core/src/preset.rs into_bridge_params).
//   - docs.world.org/world-id/idkit/error-codes: treat
//     `world_id_4_not_available` as terminal for that request and "change the
//     requested credential policy".
//
// So:
//   Stage "v4"      constraints any(proof_of_human, passport, mnc, selfie),
//                   each carrying the signal, allow_legacy_proofs false. Order
//                   is strongest first. Every World ID 4.0 holder can satisfy
//                   it: Selfie Check needs only World App and a camera.
//   Stage "legacy"  deviceLegacy({ signal }), allow_legacy_proofs true. Only
//                   opened when World App answers the v4 stage with
//                   `world_id_4_not_available` (an app or account not on 4.0
//                   yet). Device is the lowest 3.0 level, so it accepts the
//                   user's highest of Orb, Secure Document, Document, Device,
//                   and the proof is bound to the same signal.
//
// This module imports only types from the SDK, so the server and node tests
// can use it without pulling IDKit's WASM bundle.

import type {
  ConstraintNode,
  CredentialType,
  DeviceLegacyPreset,
} from "@worldcoin/idkit-core";

export type WorldRequestStage = "v4" | "legacy";

/** World ID 4.0 credentials requested, strongest first. */
export const V4_CREDENTIALS: readonly CredentialType[] = [
  "proof_of_human",
  "passport",
  "mnc",
  "selfie",
];

/** Whether a 3.0 (legacy) fallback stage is offered at all. One policy for
 *  both widgets: a player who can prove-human must also be able to confirm a
 *  payout, or they would hit a dead end after staking. */
export const LEGACY_FALLBACK_ENABLED = true;

export type WorldRequestProps =
  | {
      stage: "v4";
      allow_legacy_proofs: false;
      constraints: ConstraintNode;
      preset?: never;
    }
  | {
      stage: "legacy";
      allow_legacy_proofs: true;
      preset: DeviceLegacyPreset;
      constraints?: never;
    };

/** The request both widgets hand IDKitRequestWidget. `signal` is used as-is:
 *  the lowercased wallet for prove-human, `<goalId>:<attempt>` for settle. */
export function worldCredentialRequest(
  signal: string,
  stage: WorldRequestStage,
): WorldRequestProps {
  if (stage === "legacy") {
    return {
      stage,
      allow_legacy_proofs: true,
      preset: { type: "DeviceLegacy", signal },
    };
  }
  return {
    stage,
    allow_legacy_proofs: false,
    constraints: {
      any: V4_CREDENTIALS.map((type) => ({ type, signal })),
    },
  };
}

/** True when an IDKit error on `stage` should reopen the check on the legacy
 *  stage instead of failing (see the header). */
export function shouldFallBackToLegacy(
  code: string | null | undefined,
  stage: WorldRequestStage,
  legacyAllowed: boolean = LEGACY_FALLBACK_ENABLED,
): boolean {
  return legacyAllowed && stage === "v4" && code === "world_id_4_not_available";
}

// ------------------------------------------------------ what was verified

/**
 * The credential a verified proof used, normalised across protocol versions.
 * World ID 4.0 identifiers come from ResponseItemV4.identifier; 3.0 ones from
 * the legacy verification_level (idkit-core maps "face" to "selfie").
 */
export type WorldCredential =
  | "orb"
  | "passport"
  | "mnc"
  | "selfie"
  | "secure_document"
  | "document"
  | "device";

const IDENTIFIER_TO_CREDENTIAL: Record<string, WorldCredential> = {
  // 4.0
  proof_of_human: "orb",
  passport: "passport",
  mnc: "mnc",
  selfie: "selfie",
  // 3.0
  orb: "orb",
  secure_document: "secure_document",
  document: "document",
  device: "device",
  face: "selfie",
};

/** The credential behind a response identifier, or null when unknown. */
export function credentialFromIdentifier(
  identifier: string,
): WorldCredential | null {
  return IDENTIFIER_TO_CREDENTIAL[identifier] ?? null;
}

/** Orb-backed credentials give a one-human-one-account guarantee; the rest
 *  are weaker sybil resistance (docs/WORLD.md, "Credentials"). */
export function isOrbCredential(credential: WorldCredential | null | undefined): boolean {
  return credential === "orb";
}

/** Plain label for the feed and the receipt. */
export function credentialLabel(credential: string | null | undefined): string {
  switch (credential) {
    case "orb":
      return "Orb";
    case "passport":
      return "passport (NFC)";
    case "mnc":
      return "My Number Card (NFC)";
    case "selfie":
      return "Selfie Check";
    case "secure_document":
      return "secure document";
    case "document":
      return "document";
    case "device":
      return "World App device";
    default:
      return "World ID";
  }
}
