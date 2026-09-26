import { describe, expect, it } from "vitest";
import {
  isPublicPath,
  isSignedOutPreviewPath,
  rendersWithoutGate,
} from "@/lib/public-paths";

describe("run pages: readable signed out, gated once signed in", () => {
  const signedOut = { ready: true, signedIn: false };
  const signedIn = { ready: true, signedIn: true };
  const loading = { ready: false, signedIn: false };

  it("treats only a numeric run id as a preview", () => {
    expect(isSignedOutPreviewPath("/pools/5")).toBe(true);
    expect(isSignedOutPreviewPath("/pools/5/")).toBe(true);
    for (const path of ["/pools/create", "/pools/abc", "/pools/5/edit", "/pools"]) {
      expect(isSignedOutPreviewPath(path), path).toBe(false);
    }
  });

  it("lets a signed-out visitor read a run page", () => {
    expect(rendersWithoutGate("/pools/5", signedOut)).toBe(true);
  });

  it("sends a signed-in player through the gate, so nobody is refused at the stake", () => {
    expect(rendersWithoutGate("/pools/5", signedIn)).toBe(false);
  });

  it("does not decide before sign-in state is known", () => {
    expect(rendersWithoutGate("/pools/5", loading)).toBe(false);
  });

  it("never opens the create form or money surfaces", () => {
    for (const path of ["/pools/create", "/challenge/new", "/dashboard", "/sponsor", "/settings"]) {
      expect(rendersWithoutGate(path, signedOut), path).toBe(false);
    }
  });

  it("keeps public pages public for everyone", () => {
    expect(rendersWithoutGate("/pools", signedIn)).toBe(true);
    expect(rendersWithoutGate("/", loading)).toBe(true);
  });
});
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
