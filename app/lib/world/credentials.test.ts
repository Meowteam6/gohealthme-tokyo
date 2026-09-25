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
  it("asks for any World ID 4.0 credential, Selfie Check included, each bound to the signal", () => {
    const r = worldCredentialRequest("0xabc", "v4");
    expect(r.stage).toBe("v4");
    expect(r.allow_legacy_proofs).toBe(false);
    if (r.stage !== "v4") throw new Error("unreachable");
    const node = r.constraints as { any: Array<{ type: string; signal: string }> };
    expect(node.any.map((c) => c.type)).toEqual([...V4_CREDENTIALS]);
    expect(node.any.map((c) => c.type)).toContain("selfie");
    expect(node.any.every((c) => c.signal === "0xabc")).toBe(true);
  });

  it("falls back to the lowest 3.0 level, still bound to the signal", () => {
    const r = worldCredentialRequest("goal:1", "legacy");
    expect(r).toMatchObject({ stage: "legacy", allow_legacy_proofs: true, preset: { type: "DeviceLegacy", signal: "goal:1" } });
  });

  it("opens the legacy stage only when World App says 4.0 is not available", () => {
    expect(shouldFallBackToLegacy("world_id_4_not_available", "v4")).toBe(true);
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
