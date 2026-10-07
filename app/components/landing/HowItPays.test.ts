// The trust line beside "how it pays" (components/landing/HowItPays.tsx)
// describes who confirms before the contract pays. In open beta
// (lib/open-beta.ts) a player who skipped World ID never confirms, so the
// line says the contract pays on the verdict and names the confirmation
// only for a verified player. Flag off keeps the two lines the landing has
// shipped with. Rendered to static markup: the words are what the visitor
// reads.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HowItPays from "@/components/landing/HowItPays";

const CLOSED_CONFIRM =
  "He reads your wearable&#x27;s result, you confirm it&#x27;s you with World ID, and the contract pays.";
const NO_CONFIRM = "He reads your wearable&#x27;s result. The contract pays.";
const OPEN_CONFIRM =
  "He reads your wearable&#x27;s result and the contract pays. Verified with World ID, you confirm it&#x27;s you first.";

function render(confirm: boolean, openBeta?: boolean): string {
  return renderToStaticMarkup(
    createElement(HowItPays, {
      terms: null,
      confirm,
      missRule: true,
      ...(openBeta === undefined ? {} : { openBeta }),
    }),
  );
}

function visible(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ");
}

describe("HowItPays trust line", () => {
  it("open beta with confirmation on: the contract pays on the verdict, a verified player confirms first", () => {
    const markup = render(true, true);
    expect(markup).toContain(OPEN_CONFIRM);
    expect(markup).not.toContain(CLOSED_CONFIRM);
  });

  it("flag off with confirmation on: every player confirms with World ID", () => {
    expect(render(true, false)).toContain(CLOSED_CONFIRM);
    expect(render(true)).toContain(CLOSED_CONFIRM);
  });

  it("confirmation off: nobody confirms, whatever the flag", () => {
    expect(render(false, true)).toContain(NO_CONFIRM);
    expect(render(false, false)).toContain(NO_CONFIRM);
    expect(render(false)).toContain(NO_CONFIRM);
  });

  it("no exclamation mark and no run, pool or dare in any combination", () => {
    for (const confirm of [true, false]) {
      for (const openBeta of [true, false, undefined]) {
        const text = visible(render(confirm, openBeta));
        expect(text).not.toContain("!");
        expect(text).not.toMatch(/\b(runs?|pools?|dares?)\b/i);
      }
    }
  });
});
