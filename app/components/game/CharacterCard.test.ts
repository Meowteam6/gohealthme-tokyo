// The human stamp beside a player's name. "One human" means a World ID
// binding, "On the list" means the closed-beta list (or the admin allowlist).
// While KILL_WORLD_ID pauses World the lane reads off, so the build's mode is
// "allowlist" and the character's proof reads "list" for everyone approved;
// the server's access `source` is what still knows a wallet is World-bound.
// Pinned: a World-bound player reads "One human" with World on or paused, a
// list player reads "On the list" either way, and an unproven player gets no
// check at all.

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Character, HumanMode } from "@/lib/game/character";
import type { CharacterView } from "@/lib/game/useCharacter";
import type { AccessSource } from "@/lib/useAccess";

vi.mock("@/lib/wallet", () => ({
  useEmbeddedWallet: () => ({ address: null, authenticated: false, ready: false }),
}));
vi.mock("@/lib/game/useOpenRuns", () => ({
  useOpenRuns: () => ({ runs: [] }),
}));

const { default: CharacterCard, characterStampOf } = await import("@/components/game/CharacterCard");

const ADDRESS = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";

function character(over: Partial<Character> = {}): Character {
  return {
    address: ADDRESS,
    human: "verified",
    humanProof: "list",
    name: "ironhabit.gohealthme.eth",
    device: null,
    ...over,
  };
}

describe("characterStampOf", () => {
  it("stamps a World-bound player One human while World is paused", () => {
    // Paused: the lane is off, so mode is allowlist and the proof reads list.
    expect(characterStampOf(character({ humanProof: "list" }), "allowlist", "world")).toBe("One human");
  });

  it("stamps a World-bound player One human while World is on", () => {
    expect(characterStampOf(character({ humanProof: "world" }), "world", "world")).toBe("One human");
    // Access still loading: World's own read already said verified.
    expect(characterStampOf(character({ humanProof: "world" }), "world", "none")).toBe("One human");
  });

  it("stamps a list player On the list, World on or paused", () => {
    for (const mode of ["world", "allowlist"] as HumanMode[]) {
      expect(characterStampOf(character({ humanProof: "list" }), mode, "request")).toBe("On the list");
    }
  });

  it("keeps the admins on the list stamp", () => {
    expect(characterStampOf(character({ humanProof: "admin" }), "allowlist", "admin")).toBe("On the list");
  });

  it("gives an unproven player no stamp, whatever the access source says", () => {
    const sources: AccessSource[] = ["world", "request", "admin", "none"];
    for (const source of sources) {
      expect(characterStampOf(character({ human: "unverified", humanProof: null }), "allowlist", source)).toBeNull();
    }
  });
});

function view(c: Character, mode: HumanMode, source: AccessSource): CharacterView {
  return {
    character: c,
    humanMode: mode,
    sensor: { kind: "paired", device: { provider: "junction", label: "Oura", metrics: ["steps"] } },
    access: { source },
  } as unknown as CharacterView;
}

describe("CharacterCard strip", () => {
  it("renders One human for a World-bound player while World is paused", () => {
    const html = renderToStaticMarkup(
      createElement(CharacterCard, { view: view(character(), "allowlist", "world"), variant: "strip" }),
    );
    expect(html).toContain("One human");
    expect(html).not.toContain("On the list");
  });

  it("renders On the list for a list player", () => {
    const html = renderToStaticMarkup(
      createElement(CharacterCard, { view: view(character(), "allowlist", "request"), variant: "strip" }),
    );
    expect(html).toContain("On the list");
    expect(html).not.toContain("One human");
  });
});
