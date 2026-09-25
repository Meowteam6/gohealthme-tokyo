import { describe, expect, it } from "vitest";
import {
  characterOf,
  characterSteps,
  currentStep,
  gatePassed,
  isReadyToPlay,
  sensorFromOptions,
  type CharacterInputs,
} from "@/lib/game/character";
import type { ProviderOptions } from "@/lib/wearable-connect";

// Character creation composes four steps. Two are hard (the server enforces
// them anyway), two are soft (skippable, never a wall). A lane that is not on
// the build is walked past, and with World off the V3 allowlist still works.

const ADDRESS = "0x8a39000000000000000000000000000000006141";

function inputs(overrides: Partial<CharacterInputs> = {}): CharacterInputs {
  return {
    ready: true,
    authenticated: true,
    address: ADDRESS,
    access: { status: "none", isAdmin: false, loading: false, error: false },
    world: { lane: "on", human: "unverified" },
    ens: { lane: "on", name: null },
    handle: null,
    sensor: { kind: "none" },
    ...overrides,
  };
}

function options(
  overrides: Partial<ProviderOptions["providers"][number]> = {},
  status: ProviderOptions["status"] = "known",
): ProviderOptions {
  return {
    status,
    selected: "junction",
    providers: [
      {
        id: "junction",
        label: "Junction",
        configured: true,
        connected: true,
        metrics: ["sleep_score", "steps"],
        observedMetrics: null,
        capability: "declared",
        ...overrides,
      },
    ],
  };
}

describe("sensorFromOptions", () => {
  it("is loading while the read is in flight", () => {
    expect(sensorFromOptions(undefined, true)).toEqual({ kind: "loading" });
  });
  it("needs one signature after a reload", () => {
    expect(sensorFromOptions({ providers: [], selected: null, status: "unauthenticated" }, false)).toEqual({
      kind: "unchecked",
    });
  });
  it("reports nothing linked", () => {
    expect(sensorFromOptions(options({ connected: false }), false)).toEqual({ kind: "none" });
  });
  it("reports a linked sensor it cannot read, rather than calling it unpaired", () => {
    expect(sensorFromOptions(options({ capability: "unknown" }), false)).toEqual({
      kind: "unreadable",
      label: "Junction",
    });
  });
  it("pairs a Junction wallet with what it measures", () => {
    expect(sensorFromOptions(options(), false)).toEqual({
      kind: "paired",
      device: { provider: "junction", label: "Junction", metrics: ["sleep_score", "steps"] },
    });
  });
  it("narrows to what the device actually produced (WHOOP has no steps)", () => {
    const whoop: ProviderOptions = {
      status: "known",
      selected: "whoop",
      providers: [
        {
          id: "whoop",
          label: "WHOOP",
          configured: true,
          connected: true,
          metrics: ["sleep_score", "workouts"],
          observedMetrics: ["sleep_score"],
          capability: "observed",
        },
      ],
    };
    const read = sensorFromOptions(whoop, false);
    expect(read.kind === "paired" ? read.device.metrics : null).toEqual(["sleep_score"]);
  });
  it("reports a failed read as unavailable", () => {
    expect(sensorFromOptions(undefined, false)).toEqual({ kind: "unavailable" });
  });
});

describe("gatePassed", () => {
  it("never passes a signed-out visitor", () => {
    expect(gatePassed(inputs({ authenticated: false, address: null }))).toBe(false);
  });
  it("passes a World-verified human without an admin", () => {
    expect(gatePassed(inputs({ world: { lane: "on", human: "verified" } }))).toBe(true);
  });
  it("keeps the allowlist working with World off (no new dead end)", () => {
    const worldOff = { lane: "off" as const, human: "unknown" as const };
    expect(gatePassed(inputs({ world: worldOff }))).toBe(false);
    expect(
      gatePassed(
        inputs({
          world: worldOff,
          access: { status: "approved", isAdmin: false, loading: false, error: false },
        }),
      ),
    ).toBe(true);
  });
  it("keeps an approved pilot player in when World is switched on", () => {
    expect(
      gatePassed(
        inputs({ access: { status: "approved", isAdmin: false, loading: false, error: false } }),
      ),
    ).toBe(true);
  });
  it("does not trust a World claim when the lane is off", () => {
    expect(gatePassed(inputs({ world: { lane: "off", human: "verified" } }))).toBe(false);
  });
});

describe("characterSteps and currentStep", () => {
  const none = new Set<never>();

  it("starts at sign-in for a judge with a fresh browser", () => {
    const i = inputs({ authenticated: false, address: null });
    expect(currentStep(characterSteps(i), gatePassed(i), none, false)).toBe("sign-in");
  });

  it("holds on the human step until the gate passes, and it cannot be skipped", () => {
    const i = inputs();
    expect(currentStep(characterSteps(i), gatePassed(i), new Set(["human"]), false)).toBe("human");
  });

  it("shows the allowlist wait as waiting, not todo, with World off", () => {
    const i = inputs({
      world: { lane: "off", human: "unknown" },
      access: { status: "pending", isAdmin: false, loading: false, error: false },
    });
    expect(characterSteps(i).human.status).toBe("waiting");
  });

  it("moves to name, then sensor, and both are skippable", () => {
    const i = inputs({ world: { lane: "on", human: "verified" } });
    const steps = characterSteps(i);
    expect(currentStep(steps, true, none, false)).toBe("name");
    expect(currentStep(steps, true, new Set(["name"]), false)).toBe("sensor");
    expect(currentStep(steps, true, new Set(["name", "sensor"]), false)).toBeNull();
  });

  it("uses the existing @handle as the name when ENS is off", () => {
    const i = inputs({
      world: { lane: "on", human: "verified" },
      ens: { lane: "off", name: null },
      handle: "dre",
    });
    expect(characterSteps(i).name).toEqual({ status: "done", summary: "@dre" });
    expect(characterOf(i)?.name).toBe("@dre");
  });

  it("never interrupts a player who already finished onboarding on this device", () => {
    const i = inputs({ world: { lane: "on", human: "verified" } });
    expect(currentStep(characterSteps(i), true, none, true)).toBeNull();
    // ...but the hard gate still holds for them.
    const signedOut = inputs({ authenticated: false, address: null });
    expect(currentStep(characterSteps(signedOut), false, none, true)).toBe("sign-in");
  });

  it("asks a returning player to check the sensor, not to pair it again", () => {
    const i = inputs({ sensor: { kind: "unchecked" } });
    expect(characterSteps(i).sensor).toEqual({ status: "check" });
  });

  it("finishes when every step is done", () => {
    const i = inputs({
      world: { lane: "on", human: "verified" },
      ens: { lane: "on", name: "dre.gohealthme.eth" },
      sensor: {
        kind: "paired",
        device: { provider: "junction", label: "Junction", metrics: ["sleep_score"] },
      },
    });
    const steps = characterSteps(i);
    expect(steps.sensor).toEqual({ status: "done", summary: "Junction: sleep score" });
    expect(currentStep(steps, true, none, false)).toBeNull();
  });

  it("offers World once to an allowlisted player, skippably", () => {
    const i = inputs({
      access: { status: "approved", isAdmin: false, loading: false, error: false },
      ens: { lane: "on", name: "x.gohealthme.eth" },
      sensor: {
        kind: "paired",
        device: { provider: "junction", label: "Junction", metrics: ["steps"] },
      },
    });
    expect(currentStep(characterSteps(i), gatePassed(i), none, false)).toBe("human");
    expect(currentStep(characterSteps(i), gatePassed(i), new Set(["human"]), false)).toBeNull();
  });
});

describe("the character card", () => {
  it("is ready to play with a verified human and a paired sensor, name optional", () => {
    const c = characterOf(
      inputs({
        world: { lane: "on", human: "verified" },
        sensor: {
          kind: "paired",
          device: { provider: "junction", label: "Junction", metrics: ["steps"] },
        },
      }),
    );
    expect(c?.name).toBeNull();
    expect(c !== null && isReadyToPlay(c)).toBe(true);
  });

  it("is not ready with no wearable", () => {
    const c = characterOf(inputs({ world: { lane: "on", human: "verified" } }));
    expect(c !== null && isReadyToPlay(c)).toBe(false);
  });

  it("counts an approved allowlist player as human when World is off", () => {
    const c = characterOf(
      inputs({
        world: { lane: "off", human: "unknown" },
        access: { status: "approved", isAdmin: false, loading: false, error: false },
      }),
    );
    expect(c?.human).toBe("verified");
  });

  it("has no character before sign-in", () => {
    expect(characterOf(inputs({ authenticated: false, address: null }))).toBeNull();
  });
});
