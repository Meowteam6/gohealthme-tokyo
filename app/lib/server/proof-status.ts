// Whether SPOTTER can verify a document today, from the same facts judge.ts
// decides on: a configured attester key, or DEMO_MODE. Read per call, never
// cached at import, and never mirrored into a NEXT_PUBLIC_ variable that can
// drift from the server. The pools list, the create form, the pool page and
// /privacy all read this one answer (via /api/proof/status), so the product
// stops offering a pool nobody can be verified on the moment the verifier is
// off - measured live 2026-09-06, when prod had neither a key nor DEMO_MODE and
// every document upload failed closed while three document pools sat joinable.
//
// DEMO_MODE is refused on a production deployment (demoModeEnabled in
// lib/server/env.ts), so there documents are available only with a real
// attester key. Where DEMO_MODE is allowed (tests, local, preview) the answer
// carries mocked: true so a surface can label it. The reason is public: plain
// words, never an env var name.

import { demoModeEnabled, optionalEnv } from "@/lib/server/env";

export interface ProofAvailability {
  available: boolean;
  reason: string;
  /** True when verdicts on this deployment are mocked (never on production). */
  mocked: boolean;
}

export function documentProofStatus(): ProofAvailability {
  if (optionalEnv("CONFIDENTIAL_AI_API_KEY", "").trim() !== "") {
    // A real attester is configured. DEMO_MODE only changes what happens if
    // it fails, so the everyday verdict is real; still flag the fallback.
    return {
      available: true,
      reason: "document verifier configured",
      mocked: demoModeEnabled(),
    };
  }
  if (demoModeEnabled()) {
    return {
      available: true,
      reason: "verdicts on this test build are mocked",
      mocked: true,
    };
  }
  return {
    available: false,
    reason: "no document verifier is configured",
    mocked: false,
  };
}
