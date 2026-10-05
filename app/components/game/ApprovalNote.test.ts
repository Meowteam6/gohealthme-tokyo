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
});
