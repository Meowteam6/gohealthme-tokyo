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
      mocked: false,
    });
  });

  it("is available when an attester key is set", () => {
    vi.stubEnv("CONFIDENTIAL_AI_API_KEY", "key-1");
    vi.stubEnv("DEMO_MODE", "");
    expect(documentProofStatus()).toMatchObject({ available: true, mocked: false });
  });

  it("is available in DEMO_MODE off production, and says it is mocked", () => {
    vi.stubEnv("CONFIDENTIAL_AI_API_KEY", "");
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(documentProofStatus()).toEqual({
      available: true,
      reason: "verdicts on this test build are mocked",
      mocked: true,
    });
  });

  it("refuses DEMO_MODE on a production deployment: fails closed, no env name in the reason", () => {
    vi.stubEnv("CONFIDENTIAL_AI_API_KEY", "");
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("VERCEL_ENV", "production");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = documentProofStatus();
    expect(status).toEqual({
      available: false,
      reason: "no document verifier is configured",
      mocked: false,
    });
    expect(status.reason).not.toMatch(/[A-Z]{2,}_[A-Z]/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
