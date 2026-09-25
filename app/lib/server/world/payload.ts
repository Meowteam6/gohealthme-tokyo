// Shape check for the IDKit result payload before anything is trusted.
//
// The payload is what the widget hands handleVerify (IDKitResult in
// @worldcoin/idkit-core): protocol_version "3.0" (legacy) or "4.0", the
// action, the environment the request ran in, and responses[] whose first
// item carries the nullifier and, when the request asked for one, the
// signal_hash. Session proofs (session_id present) are a different product
// and are refused: this gate needs a uniqueness proof.
//
// Nothing here verifies the proof. It only rejects payloads that could not
// be an IDKit result, so the verifiers downstream can index into a known
// shape and the raw object can be forwarded to World untouched.

export type ProtocolVersion = "3.0" | "4.0";

export interface ParsedProof {
  protocolVersion: ProtocolVersion;
  action: string;
  environment: string;
  /** Credential identifier of responses[0], e.g. "proof_of_human". */
  identifier: string;
  /** responses[0].nullifier, as sent (hex). */
  nullifier: string;
  /** responses[0].signal_hash, or null when the payload carries none. */
  signalHash: string | null;
  /** The untouched payload, for forwarding to World as-is. */
  raw: Record<string, unknown>;
}

export type ParsePayloadResult =
  | { ok: true; proof: ParsedProof }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseIdkitPayload(input: unknown): ParsePayloadResult {
  if (!isRecord(input)) {
    return { ok: false, reason: "proof must be the IDKit result object" };
  }
  const version = input.protocol_version;
  if (version !== "3.0" && version !== "4.0") {
    return {
      ok: false,
      reason: 'proof.protocol_version must be "3.0" or "4.0"',
    };
  }
  if (input.session_id !== undefined) {
    return {
      ok: false,
      reason: "session proofs are not accepted here; a uniqueness proof is required",
    };
  }
  const action = input.action;
  if (typeof action !== "string" || action.trim() === "") {
    return { ok: false, reason: "proof.action must be a non-empty string" };
  }
  const environment =
    typeof input.environment === "string" ? input.environment : "";
  const responses = input.responses;
  if (!Array.isArray(responses) || responses.length === 0) {
    return { ok: false, reason: "proof.responses must be a non-empty array" };
  }
  const first: unknown = responses[0];
  if (!isRecord(first)) {
    return { ok: false, reason: "proof.responses[0] must be an object" };
  }
  if (typeof first.identifier !== "string" || first.identifier === "") {
    return { ok: false, reason: "proof.responses[0].identifier is missing" };
  }
  if (typeof first.nullifier !== "string" || first.nullifier === "") {
    return { ok: false, reason: "proof.responses[0].nullifier is missing" };
  }
  const signalHash = first.signal_hash;
  if (
    signalHash !== undefined &&
    (typeof signalHash !== "string" || !/^0x[0-9a-fA-F]+$/.test(signalHash))
  ) {
    return { ok: false, reason: "proof.responses[0].signal_hash must be 0x hex" };
  }
  return {
    ok: true,
    proof: {
      protocolVersion: version,
      action,
      environment,
      identifier: first.identifier,
      nullifier: first.nullifier,
      signalHash: signalHash === undefined ? null : signalHash,
      raw: input,
    },
  };
}
