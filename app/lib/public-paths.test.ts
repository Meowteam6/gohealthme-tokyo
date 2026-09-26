import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/public-paths";
import { PUBLIC_PATHS } from "@/lib/site";

describe("isPublicPath", () => {
  it("lets a signed-out visitor browse the lobby and the payout feed", () => {
    expect(isPublicPath("/pools")).toBe(true);
    expect(isPublicPath("/pools/")).toBe(true);
    expect(isPublicPath("/feed")).toBe(true);
  });

  it("lets a signed-out visitor read History (SPOTTER's public feed)", () => {
    expect(isPublicPath("/agent")).toBe(true);
  });

  it("keeps the run page, create forms and money surfaces gated", () => {
    for (const path of [
      "/pools/3",
      "/pools/create",
      "/challenge/new",
      "/dashboard",
      "/sponsor",
      "/settings",
    ]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });

  it("keeps the landing, legal pages, profiles and invite links public", () => {
    for (const path of ["/", "/privacy", "/terms", "/u/alice", "/c/abc"]) {
      expect(isPublicPath(path)).toBe(true);
    }
  });

  it("only lists sitemap pages a signed-out crawler can actually read", () => {
    for (const path of PUBLIC_PATHS) {
      expect(isPublicPath(path)).toBe(true);
    }
  });
});
