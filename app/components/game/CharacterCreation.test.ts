// Step 2 of character creation in open beta (Andre and Nikki, 2026-10-07):
// World ID is optional, said in one line, with the scan and a skip, and the
// closed-beta list is nowhere on the page. With the flag off the list offer
// is back. Rendered to static markup with the lanes' components stubbed; the
// markup is what the player reads, so the words are pinned here.

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CharacterView } from "@/lib/game/useCharacter";
import type { Onboarding } from "@/lib/game/onboarding-store";
import type { StepState } from "@/lib/game/character";

const probe = vi.hoisted(() => ({ approvalMode: "off" as string, worldPaused: false }));

vi.mock("@/lib/wallet", () => ({
  useEmbeddedWallet: () => ({ address: null, authenticated: false, ready: false }),
}));
vi.mock("@/lib/game/useOpenRuns", () => ({ useOpenRuns: () => ({ runs: [] }) }));
vi.mock("@/lib/game/useSwitches", () => ({
  useSwitches: () => ({
    worldPaused: probe.worldPaused,
    reason: null,
    moneyIn: "open",
    loading: false,
    error: false,
    refetch: () => undefined,
  }),
}));
vi.mock("@/components/game/ApprovalNote", () => ({
  useApprovalMode: () => probe.approvalMode,
}));
vi.mock("@/components/world/ProveHuman", () => ({
  default: () => createElement("div", { "data-stub": "prove-human" }),
}));
vi.mock("@/components/ens/EnsNameClaim", () => ({
  default: () => createElement("div", { "data-stub": "ens-name-claim" }),
}));
vi.mock("@/components/ClaimHandle", () => ({
  default: () => createElement("div", { "data-stub": "claim-handle" }),
}));
vi.mock("@/components/RequestAccess", () => ({
  default: () => createElement("div", { "data-stub": "request-access" }),
}));
vi.mock("@/components/game/SensorStep", () => ({
  default: () => createElement("div", { "data-stub": "sensor-step" }),
}));
vi.mock("@/components/game/SignInStep", () => ({
  default: () => createElement("div", { "data-stub": "sign-in-step" }),
}));

const { default: CharacterCreation } = await import("@/components/game/CharacterCreation");

const ADDRESS = "0x8ba1f109551bD432803012645Ac136ddd64DBA72" as const;
const noop = () => undefined;

function view(over: {
  human: StepState;
  openBeta?: boolean;
  gate: boolean;
  worldLane?: CharacterView["worldLane"];
}): CharacterView {
  return {
    ready: true,
    authenticated: true,
    address: ADDRESS,
    character: {
      address: ADDRESS,
      human: over.human.status === "done" ? "verified" : "unverified",
      humanProof: over.human.status === "done" ? "world" : null,
      name: null,
      device: null,
    },
    steps: {
      "sign-in": { status: "done", summary: "Signed in" },
      human: over.human,
      name: { status: "todo" },
      sensor: { status: "todo" },
    },
    gate: over.gate,
    gateLoading: false,
    ...(over.openBeta === undefined ? {} : { openBeta: over.openBeta }),
    humanMode: (over.worldLane ?? "on") === "on" ? "world" : "allowlist",
    nameMode: "ens",
    worldLane: over.worldLane ?? "on",
    ensLane: "on",
    sensor: { kind: "none" },
    providers: undefined,
    access: {
      loading: false,
      error: false,
      status: "none",
      isAdmin: false,
      source: "none",
      authenticated: true,
      address: ADDRESS,
      refetch: noop,
    },
    checkSensor: async () => false,
    checkingSensor: false,
    refresh: noop,
  } as unknown as CharacterView;
}

const onboarding: Onboarding = {
  skipped: new Set(),
  done: false,
  hydrated: true,
  skip: noop,
  finish: noop,
  reopen: noop,
};

function render(v: CharacterView, focus: "human" | null = null): string {
  return renderToStaticMarkup(
    createElement(CharacterCreation, { view: v, onboarding, mode: "gate", focus }),
  );
}

describe("CharacterCreation step 2 in open beta", () => {
  it("offers World ID as optional with a skip, and never the list", () => {
    probe.approvalMode = "off";
    const html = render(view({ human: { status: "todo" }, gate: true, openBeta: true }));
    expect(html).toContain("Optional. Verify with World ID to carry the one human, one entry badge.");
    expect(html).toContain("Skip for now");
    expect(html).toContain('data-stub="prove-human"');
    expect(html).toContain("Scan once for the one human, one entry badge, or skip it.");
    expect(html).not.toContain("Ask for a spot on the list");
    expect(html).not.toContain("request-access");
    expect(html).not.toContain("confirm each payout");
  });

  it("titles step 2 as optional, never as the rule", () => {
    probe.approvalMode = "off";
    const html = render(view({ human: { status: "todo" }, gate: true, openBeta: true }));
    // The row title is the first thing read; "Prove you are one human" is an
    // order, and in open beta it is not one.
    expect(html).toContain("Step 2: </span>World ID, optional");
    expect(html).not.toContain("Prove you are one human");
    // The old rule, stated as the rule, belongs to the closed beta
    // (components/world/ProveHuman.tsx says the badge instead).
    expect(html).not.toContain("One human, one entry. World ID checks");
  });

  it("says the payout confirmation moves to World ID before the scan, where it is on", () => {
    probe.approvalMode = "world";
    const html = render(view({ human: { status: "todo" }, gate: true, openBeta: true }));
    expect(html).toContain("After that, you confirm each payout with World ID before it moves.");
    probe.approvalMode = "off";
  });

  it("says World is off and lets the player skip, with no list", () => {
    const html = render(
      view({
        human: { status: "off", note: "World ID is not switched on for this build." },
        gate: true,
        openBeta: true,
        worldLane: "off",
      }),
      "human",
    );
    expect(html).toContain("World ID is not switched on for this build. You can play without it.");
    expect(html).toContain("Skip for now");
    expect(html).not.toContain("request-access");
    expect(html).not.toContain("the list");
  });

  it("offers a retry and a skip when World is not answering", () => {
    const html = render(
      view({
        human: { status: "error", note: "SPOTTER could not reach World ID just now." },
        gate: true,
        openBeta: true,
        worldLane: "error",
      }),
    );
    expect(html).toContain("SPOTTER could not reach World ID just now.");
    expect(html).toContain("Check again");
    expect(html).toContain("Skip for now");
  });

  it("keeps the list offer with the flag off (regression)", () => {
    const html = render(view({ human: { status: "todo" }, gate: false }));
    expect(html).toContain("Ask for a spot on the list");
    expect(html).toContain("One human, one entry. No bots, no twins.");
    expect(html).toContain("Step 2: </span>Prove you are one human");
    expect(html).not.toContain("World ID, optional");
    expect(html).not.toContain("Optional. Verify with World ID");
    expect(html).not.toContain("Skip for now");
  });
});
