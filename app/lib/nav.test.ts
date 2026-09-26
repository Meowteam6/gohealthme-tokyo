import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, SIGNED_OUT_NAV_ITEMS } from "@/lib/nav";

describe("SIGNED_OUT_NAV_ITEMS", () => {
  it("is Challenges and How it pays for a visitor with no player yet (Nikki, 2026-09-27)", () => {
    expect(SIGNED_OUT_NAV_ITEMS.map((i) => i.label)).toEqual(["Challenges", "How it pays"]);
    expect(SIGNED_OUT_NAV_ITEMS.map((i) => i.href)).toEqual(["/pools", "/#how"]);
  });
});

// The header nav, named for the game loop. Every tab points at a real page.

describe("NAV_ITEMS", () => {
  it("is Lobby, My runs, History, Challenges, Settings, in that order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      "Lobby",
      "My runs",
      "History",
      "Challenges",
      "Settings",
    ]);
  });

  it("drops the SPOTTER, Sponsor and Wallet tabs", () => {
    const labels = NAV_ITEMS.map((i) => i.label);
    for (const gone of ["SPOTTER", "Sponsor", "Wallet"]) {
      expect(labels).not.toContain(gone);
    }
  });

  it("points every tab at a page that exists", () => {
    for (const { href } of NAV_ITEMS) {
      const page = path.resolve(__dirname, "..", "app", `.${href}`, "page.tsx");
      expect(existsSync(page), href).toBe(true);
    }
  });
});
