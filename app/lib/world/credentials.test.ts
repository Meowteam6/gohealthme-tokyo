import { describe, it, expect } from "vitest";
import {
  V4_CREDENTIALS,
  worldCredentialRequest,
  shouldFallBackToLegacy,
  credentialFromIdentifier,
  isOrbCredential,
  credentialLabel,
} from "@/lib/world/credentials";

// Founder decision 2026-09-26: no Orb gate. Pinned here so a later change
// cannot quietly narrow who can play.

describe("world credential policy", () => {
  it("asks for Orb, passport or My Number Card (never the preview Selfie Check), each bound to the signal", () => {
    const r = worldCredentialRequest("0xabc", "v4");
    expect(r.stage).toBe("v4");
    expect(r.allow_legacy_proofs).toBe(false);
    if (r.stage !== "v4") throw new Error("unreachable");
    const node = r.constraints as { any: Array<{ type: string; signal: string }> };
    expect(node.any.map((c) => c.type)).toEqual([...V4_CREDENTIALS]);
    expect(node.any.map((c) => c.type)).not.toContain("selfie");
    expect(node.any.every((c) => c.signal === "0xabc")).toBe(true);
  });

  it("falls back to the lowest 3.0 level, still bound to the signal", () => {
    const r = worldCredentialRequest("goal:1", "legacy");
    expect(r).toMatchObject({ stage: "legacy", allow_legacy_proofs: true, preset: { type: "DeviceLegacy", signal: "goal:1" } });
  });

  it("opens the legacy stage when World App cannot satisfy the 4.0 request", () => {
    expect(shouldFallBackToLegacy("world_id_4_not_available", "v4")).toBe(true);
    expect(shouldFallBackToLegacy("credential_unavailable", "v4")).toBe(true);
    expect(shouldFallBackToLegacy("feature_unavailable", "v4")).toBe(true);
    expect(shouldFallBackToLegacy("user_rejected", "v4")).toBe(false);
    expect(shouldFallBackToLegacy("world_id_4_not_available", "legacy")).toBe(false);
  });

  it("maps every accepted credential and never treats a non-Orb one as unknown", () => {
    for (const id of ["proof_of_human", "passport", "mnc", "selfie", "orb", "secure_document", "document", "device", "face"]) {
      expect(credentialFromIdentifier(id)).not.toBeNull();
    }
    expect(isOrbCredential(credentialFromIdentifier("proof_of_human"))).toBe(true);
    expect(isOrbCredential(credentialFromIdentifier("selfie"))).toBe(false);
    expect(credentialLabel("device")).toBe("World App device");
  });
});
