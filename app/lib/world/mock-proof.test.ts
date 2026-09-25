import { describe, it, expect } from "vitest";
import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { parseIdkitPayload } from "@/lib/server/world/payload";
import { verifyMock } from "@/lib/server/world/verify";
import {
  MOCK_ENVIRONMENT,
  buildMockProof,
  normalizeMockIdentity,
} from "@/lib/world/mock-proof";

// The mock payload the card builds must be exactly what the server's parser
// and mock verifier accept, and the same identity must always produce the
// same nullifier on the server. Pinned end to end through the real server
// functions, since a drift between the two halves would break the demo's
// denied path silently.

const A = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";
const B = "0x2222222222222222222222222222222222222222";

describe("buildMockProof", () => {
  it("builds an IDKit-shaped v4 payload the server parser accepts", () => {
    const proof = buildMockProof({ address: A, identity: "Andre", action: "prove-human" });
    expect(proof.protocol_version).toBe("4.0");
    expect(proof.environment).toBe(MOCK_ENVIRONMENT);
    expect(proof.responses[0].signal_hash).toBe(hashSignal(A.toLowerCase()));
    expect(proof.responses[0].proof).toHaveLength(5);
    const parsed = parseIdkitPayload(proof);
    expect(parsed.ok).toBe(true);
  });

  it("maps the same identity (any casing or spacing) to the same server nullifier, and a second wallet too", () => {
    const run = (address: string, identity: string) => {
      const parsed = parseIdkitPayload(buildMockProof({ address, identity, action: "prove-human" }));
      if (!parsed.ok) throw new Error(parsed.reason);
      return verifyMock({ proof: parsed.proof, address, action: "prove-human" });
    };
    const a1 = run(A, "andre");
    const a2 = run(A, "  Andre ");
    const b = run(B, "andre");
    const other = run(A, "nikki");
    expect(a1.ok && a2.ok && b.ok && other.ok).toBe(true);
    if (a1.ok && a2.ok && b.ok && other.ok) {
      expect(a1.nullifierHash).toBe(a2.nullifierHash);
      // Same human on a second wallet: same nullifier, which is what bindHuman
      // turns into the 409.
      expect(b.nullifierHash).toBe(a1.nullifierHash);
      expect(other.nullifierHash).not.toBe(a1.nullifierHash);
    }
  });

  it("is bound to the wallet it was built for", () => {
    const parsed = parseIdkitPayload(buildMockProof({ address: A, identity: "andre", action: "prove-human" }));
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(verifyMock({ proof: parsed.proof, address: B, action: "prove-human" })).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("refuses an empty identity and uses a fresh nonce each time", () => {
    expect(() => buildMockProof({ address: A, identity: "   ", action: "x" })).toThrow(/identity/);
    expect(normalizeMockIdentity(" Nikki ")).toBe("nikki");
    const one = buildMockProof({ address: A, identity: "a", action: "x" });
    const two = buildMockProof({ address: A, identity: "a", action: "x" });
    expect(one.nonce).not.toBe(two.nonce);
  });
});
