import { describe, expect, it } from "vitest";
import { approvalNoteOf } from "@/components/game/ApprovalNote";

// The join note says how this player's hit is released, before the stake.
// Andre, 2026-10-02 ("Pay on the verdict"): a list player or an admin is paid
// on the wearable verdict; a World-verified player confirms with World ID.

describe("approvalNoteOf", () => {
  it("tells a World-verified player the World ID confirm comes before the payout", () => {
    const note = approvalNoteOf({ approvalMode: "world", humanProof: "world" });
    expect(note?.path).toBe("world");
    expect(note?.text).toMatch(/confirm with World ID/);
    expect(note?.mocked).toBe(false);
  });

  it("never tells a list player or an admin to confirm with World ID", () => {
    for (const humanProof of ["list", "admin"] as const) {
      const note = approvalNoteOf({ approvalMode: "world", humanProof });
      expect(note?.path).toBe("verdict");
      expect(note?.text).not.toMatch(/World ID/);
      expect(note?.text).toMatch(/pays/);
    }
  });

  it("flags a mocked confirm only where the player would see the World ID line", () => {
    expect(approvalNoteOf({ approvalMode: "mock", humanProof: "world" })?.mocked).toBe(true);
    expect(approvalNoteOf({ approvalMode: "mock", humanProof: "list" })?.mocked).toBe(false);
  });

  it("says nothing while the mode is off, loading, failed or misconfigured", () => {
    for (const approvalMode of ["off", "loading", "error", "misconfigured"] as const) {
      expect(approvalNoteOf({ approvalMode, humanProof: "world" })).toBeNull();
    }
  });

  // Open beta (Andre and Nikki, 2026-10-07): a wallet that skipped World ID
  // is paid on the verdict and reads that line; a World-verified player still
  // reads the World ID line. Flag off, an unproven wallet reads "world".
  describe("in open beta", () => {
    it("tells a wallet that skipped World ID it is paid on the verdict", () => {
      const note = approvalNoteOf({ approvalMode: "world", humanProof: null, openBeta: true });
      expect(note?.path).toBe("verdict");
      expect(note?.text).not.toMatch(/World ID/);
      expect(note?.text).toBe("SPOTTER pays your hit on your wearable's verdict, with no extra step.");
      expect(note?.mocked).toBe(false);
      expect(approvalNoteOf({ approvalMode: "mock", humanProof: null, openBeta: true })?.mocked).toBe(false);
    });

    it("keeps the World ID line for a World-verified player", () => {
      const note = approvalNoteOf({ approvalMode: "world", humanProof: "world", openBeta: true });
      expect(note?.path).toBe("world");
      expect(note?.text).toMatch(/confirm with World ID/);
    });

    it("changes nothing with the flag off (regression)", () => {
      expect(approvalNoteOf({ approvalMode: "world", humanProof: null })?.path).toBe("world");
      expect(approvalNoteOf({ approvalMode: "world", humanProof: null, openBeta: false })?.path).toBe("world");
    });
  });
});
