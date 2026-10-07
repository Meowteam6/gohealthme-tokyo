// The step 2 card's words in open beta (Andre and Nikki, 2026-10-07): a
// player who skips World ID still plays, so the card offers the one human,
// one entry badge and never states the old rule as the rule. With the flag
// off the card reads as the closed beta always did. Rendered to static
// markup: effects never run, so the card sits in its loading phase and the
// heading and lead are what is pinned.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The IDKit host pulls the SDK's WASM; it never renders in this test.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/useWalletAuth", () => ({
  useWalletAuth: () => async () => ({ kind: "declined" }),
}));

const { default: ProveHuman } = await import("@/components/world/ProveHuman");

const ADDRESS = "0x8ba1f109551bD432803012645Ac136ddd64DBA72";

function render(): string {
  return renderToStaticMarkup(
    createElement(ProveHuman, { address: ADDRESS, onVerified: () => undefined }),
  );
}

describe("ProveHuman copy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("in open beta offers the badge, never the rule", () => {
    vi.stubEnv("NEXT_PUBLIC_ACCESS_GATE_DISABLED", "1");
    const html = render();
    expect(html).toContain("Add World ID.");
    expect(html).toContain(
      "The one human, one entry badge. World ID checks that you are a person, not who you are.",
    );
    expect(html).not.toContain("re one human.");
    expect(html).not.toContain("One human, one entry. World ID checks");
  });

  it("with the flag off states the rule (regression)", () => {
    vi.stubEnv("NEXT_PUBLIC_ACCESS_GATE_DISABLED", "");
    const html = render();
    expect(html).toMatch(/Prove you(&#x27;|&apos;|')re one human\./);
    expect(html).toContain(
      "One human, one entry. World ID checks that you are a person, not who you are.",
    );
    expect(html).not.toContain("Add World ID.");
  });
});
