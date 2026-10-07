// The privacy notice describes THIS deployment, the same way the terms do
// (app/terms/page.test.ts). With the open-beta switch on (lib/open-beta.ts)
// World ID is optional and the closed-beta request form and list are off the
// player's path, so the page says so; with it off the page is byte-for-byte
// the closed-beta text.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PrivacyPage from "@/app/privacy/page";

function render(flag: string): string {
  vi.stubEnv("NEXT_PUBLIC_ACCESS_GATE_DISABLED", flag);
  return renderToStaticMarkup(createElement(PrivacyPage));
}

/** The markup with tags and the REVIEW comments stripped: what a reader sees. */
function visible(markup: string): string {
  return markup.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PrivacyPage, open beta", () => {
  it("says World ID is optional and drops the request form and the list", () => {
    const markup = render("1");
    expect(markup).toContain("If you verify with World ID, you scan with the World App");
    expect(markup).toContain("During the beta World ID is optional; nobody is held on a list.");
    expect(markup).not.toContain("To play, you prove you are one human");
    expect(markup).not.toContain("the request form stores what you type");
    expect(markup).not.toContain("Some US states are not admitted");
    expect(markup).not.toContain("closed-beta list decides who can play");
  });

  it("keeps the rest of the notice", () => {
    const markup = render("1");
    expect(markup).toContain("Health data never goes on chain.");
    expect(markup).toContain("Payout wallets are screened");
    expect(markup).toContain("Who processes your data");
    expect(markup).toContain("On a test build the World step can be simulated.");
  });
});

describe("PrivacyPage, flag off", () => {
  it("is the closed-beta text, unchanged", () => {
    const markup = render("");
    expect(markup).toContain("To play, you prove you are one human by scanning with the World App");
    expect(markup).toContain("the request form stores what you type");
    expect(markup).toContain("Some US states are not admitted to the beta");
    expect(markup).toContain("closed-beta list decides who can play");
    expect(markup).not.toContain("World ID is optional");
    expect(markup).not.toContain("If you verify with World ID");
  });

  it("treats any value but 1 as off", () => {
    const markup = render("true");
    expect(markup).toContain("closed-beta list decides who can play");
    expect(markup).not.toContain("World ID is optional");
  });
});

describe("PrivacyPage, both", () => {
  it("has no exclamation mark in the visible text", () => {
    for (const flag of ["1", ""]) {
      expect(visible(render(flag))).not.toContain("!");
    }
  });
});
