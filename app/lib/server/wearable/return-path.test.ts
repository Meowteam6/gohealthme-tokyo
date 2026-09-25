import { describe, it, expect } from "vitest";
import { safeReturnPath } from "@/lib/server/wearable/return-path";

// The WHOOP callback redirects to this value, and the value is
// caller-controlled. Anything but a same-origin path is an open redirect
// through our domain.

describe("safeReturnPath", () => {
  it("keeps an in-app path and its query", () => {
    expect(safeReturnPath("/character?step=sensor&next=%2Fpools%2F3")).toBe(
      "/character?step=sensor&next=%2Fpools%2F3",
    );
    expect(safeReturnPath("/pools/12")).toBe("/pools/12");
  });

  it("drops a stale whoop outcome so only the new one is read", () => {
    expect(safeReturnPath("/character?step=sensor&whoop=failed")).toBe(
      "/character?step=sensor",
    );
  });

  it.each([
    "https://evil.test/",
    "//evil.test/path",
    "/\\evil.test",
    "evil.test",
    "javascript:alert(1)",
    "/pools\n/3",
    "/api/whoop/login?ticket=x",
    "",
    `/${"a".repeat(600)}`,
  ])("refuses %s", (value) => {
    expect(safeReturnPath(value)).toBeNull();
  });

  it("refuses anything that is not a string", () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(42)).toBeNull();
  });
});
