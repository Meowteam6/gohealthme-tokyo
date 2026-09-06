import { describe, it, expect, vi, afterEach } from "vitest";
import { documentProofStatus } from "@/lib/server/proof-status";

// Whether SPOTTER can verify a document today, decided from the same facts
// judge.ts decides on: a configured attester key, or DEMO_MODE. Pinned after
// the 2026-09-06 pilot finding that prod had neither, every upload failed
// closed, and the UI still offered document pools and claimed an enclave.
// This is the single source of truth the pools list, the create form, the
// pool page and /privacy read - never a NEXT_PUBLIC_ mirror that can drift.

afterEach(() => vi.unstubAllEnvs());

describe("documentProofStatus", () => {
  it("is unavailable with no attester key and DEMO_MODE off", () => {
    vi.stubEnv("CONFIDENTIAL_AI_API_KEY", "");
    vi.stubEnv("DEMO_MODE", "");
    expect(documentProofStatus()).toEqual({
      available: false,
      reason: "no document verifier is configured",
    });
  });

  it("is available when an attester key is set", () => {
    vi.stubEnv("CONFIDENTIAL_AI_API_KEY", "key-1");
    vi.stubEnv("DEMO_MODE", "");
    expect(documentProofStatus().available).toBe(true);
  });

  it("is available in DEMO_MODE, and says so", () => {
    vi.stubEnv("CONFIDENTIAL_AI_API_KEY", "");
    vi.stubEnv("DEMO_MODE", "true");
    expect(documentProofStatus()).toEqual({
      available: true,
      reason: "DEMO_MODE: verdicts are mocked",
    });
  });
});
