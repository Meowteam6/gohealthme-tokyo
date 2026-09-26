import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NIGHT_PALETTE } from "./night-palette";

const css = readFileSync(path.join(__dirname, "..", "app", "globals.css"), "utf8");

function token(name: string): string | null {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  return m === null ? null : m[1].toLowerCase();
}

const CSS_NAME: Record<keyof typeof NIGHT_PALETTE, string> = {
  background: "background",
  surface: "surface",
  surfaceRaised: "surface-raised",
  foreground: "foreground",
  muted: "muted",
  haze: "haze",
  moonlight: "moonlight",
  gold: "gold",
  moon1: "moon-1",
  moon2: "moon-2",
  moon3: "moon-3",
  moon4: "moon-4",
};

describe("NIGHT_PALETTE mirrors globals.css", () => {
  for (const [key, value] of Object.entries(NIGHT_PALETTE)) {
    it(`${key} matches --${CSS_NAME[key as keyof typeof NIGHT_PALETTE]}`, () => {
      expect(token(CSS_NAME[key as keyof typeof NIGHT_PALETTE])).toBe(value);
    });
  }

  it("declares the dark colour scheme and none of the Riverbank tokens", () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
    for (const gone of ["--coral", "--shadow-pop", "--board", "--chalk", "--font-hand", "--accent-strong"]) {
      expect(css, gone).not.toContain(`${gone}:`);
    }
  });
});
