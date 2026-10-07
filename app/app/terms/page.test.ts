// The terms describe THIS deployment. With the open-beta switch on
// (lib/open-beta.ts) World ID is optional and the closed-beta list and its
// US-state line are off the player's path, so the page says so; with it off
// the page is byte-for-byte the closed-beta text.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TermsPage from "@/app/terms/page";

function render(flag: string): string {
  vi.stubEnv("NEXT_PUBLIC_ACCESS_GATE_DISABLED", flag);
  return renderToStaticMarkup(createElement(TermsPage));
}

/** The markup with tags and the REVIEW comments stripped: what a reader sees. */
function visible(markup: string): string {
  return markup.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TermsPage, open beta", () => {
  it("says World ID is optional and drops the list and the US-state line", () => {
    const markup = render("1");
    expect(markup).toContain("World ID is optional during the beta");
    expect(markup).toContain("One human, one entry, if you choose it.");
    expect(markup).toContain("still plays and is paid on the verdict alone");
    expect(markup).toContain("If you did not, SPOTTER records your hit on your wearable");
    expect(markup).toContain("If you verified with World ID, SPOTTER may ask you to confirm");
    // The requirement sentence is gone, not followed by a softener.
    expect(markup).not.toContain("and prove you are one human with World ID");
    expect(markup).toContain("If you verify with World ID, one human is bound to one wallet");
    expect(markup).not.toContain("closed-beta list");
    expect(markup).not.toContain("Some US states");
    expect(markup).not.toContain("approved through the closed-beta list");
  });

  it("keeps the rest of the terms", () => {
    const markup = render("1");
    expect(markup).toContain("Test money, no real value");
    expect(markup).toContain("How a challenge pays out");
    expect(markup).toContain("Do not use another person");
  });
});

describe("TermsPage, flag off", () => {
  it("is the closed-beta text, unchanged", () => {
    const markup = render("");
    expect(markup).toContain("closed-beta list decides");
    expect(markup).toContain("Some US states are not admitted to the closed beta");
    expect(markup).toContain("If you joined with World ID, SPOTTER records a hit");
    expect(markup).toContain("were approved through the closed-beta list");
    expect(markup).toContain("Before a win is paid, SPOTTER may ask you to confirm");
    expect(markup).not.toContain("World ID is optional");
    expect(markup).not.toContain("if you choose it");
  });

  it("treats any value but 1 as off", () => {
    const markup = render("true");
    expect(markup).toContain("closed-beta list decides");
    expect(markup).not.toContain("World ID is optional");
  });
});

describe("TermsPage, both", () => {
  it("has no exclamation mark in the visible text", () => {
    for (const flag of ["1", ""]) {
      expect(visible(render(flag))).not.toContain("!");
    }
  });
});
