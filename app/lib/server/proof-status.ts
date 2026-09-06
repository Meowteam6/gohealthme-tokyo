// Whether SPOTTER can verify a document today, from the same facts judge.ts
// decides on: a configured attester key, or DEMO_MODE. Read per call, never
// cached at import, and never mirrored into a NEXT_PUBLIC_ variable that can
// drift from the server. The pools list, the create form, the pool page and
// /privacy all read this one answer (via /api/proof/status), so the product
// stops offering a pool nobody can be verified on the moment the verifier is
// off - measured live 2026-09-06, when prod had neither a key nor DEMO_MODE and
// every document upload failed closed while three document pools sat joinable.

import { optionalEnv } from "@/lib/server/env";

export interface ProofAvailability {
  available: boolean;
  reason: string;
}

export function documentProofStatus(): ProofAvailability {
  const demo = optionalEnv("DEMO_MODE", "").toLowerCase();
  if (demo === "true" || demo === "1") {
    return { available: true, reason: "DEMO_MODE: verdicts are mocked" };
  }
  if (optionalEnv("CONFIDENTIAL_AI_API_KEY", "").trim() !== "") {
    return { available: true, reason: "attester configured" };
  }
  return { available: false, reason: "no document verifier is configured" };
}
