import { describe, it, expect } from "vitest";
import { idkitErrorView } from "@/lib/world/idkit-errors";

// The card's copy for IDKit error codes. Pinned: a cancel is a choice and
// stays retryable; "already used" is the one non-retryable denial the demo
// shows; unknown codes get a generic line with the code appended so nothing
// is ever silent.

describe("idkitErrorView", () => {
  it("reads a cancel as a choice, not a failure", () => {
    for (const code of ["user_rejected", "cancelled", "verification_rejected"]) {
      const view = idkitErrorView(code);
      expect(view.cancelled).toBe(true);
      expect(view.retryable).toBe(true);
    }
    expect(idkitErrorView("user_rejected").detail).toMatch(/nothing was staked/);
  });

  it("marks an already-used World ID as denied and not retryable", () => {
    const view = idkitErrorView("max_verifications_reached");
    expect(view.retryable).toBe(false);
    expect(view.cancelled).toBe(false);
    expect(view.detail).toMatch(/One human, one entry/);
  });

  it("keeps operator mistakes visible and non-retryable", () => {
    for (const code of ["invalid_rp_signature", "unknown_rp", "inactive_rp"]) {
      expect(idkitErrorView(code).retryable).toBe(false);
      expect(idkitErrorView(code).detail).toMatch(/Andre/);
    }
  });

  it("falls back to a generic retryable line that names an unknown code", () => {
    const view = idkitErrorView("something_new");
    expect(view.retryable).toBe(true);
    expect(view.detail).toContain("something_new");
    expect(idkitErrorView(null).title).toBe("Could not verify.");
    expect(idkitErrorView(undefined).retryable).toBe(true);
  });
});
