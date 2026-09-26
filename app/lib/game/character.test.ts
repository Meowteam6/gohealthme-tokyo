import { describe, expect, it } from "vitest";
import {
  characterOf,
  characterSteps,
  creationBlocks,
  currentStep,
  gatePassed,
  hardGateClosed,
  isReadyToPlay,
  measurableGoalsOf,
  NAME_LOCKED_NOTE,
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
  it("a Junction link before its first sync is linked and waiting, never 'nothing linked' (Nikki, 2026-09-27)", () => {
    expect(sensorFromOptions(options({ metrics: [] }), false)).toEqual({
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
        device: {
          provider: "whoop",
          label: "WHOOP",
          metrics: ["sleep_score", "sleep_efficiency", "sleep_hours", "workouts"],
        },
      },
    });
    const steps = characterSteps(i);
    // Says what counts, like the pairing card: sleep score is not a launch goal.
    expect(steps.sensor).toEqual({
      status: "done",
      summary: "WHOOP",
    });
    expect(characterOf(i)?.device).not.toBeNull();
    expect(measurableGoalsOf(characterOf(i)!.device!)).toEqual([
      "sleep efficiency",
      "hours of sleep",
      "workouts",
    ]);
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

  it("locks the ENS name step until the human step is done while World is on", () => {
    const i = inputs({
      access: { status: "approved", isAdmin: false, loading: false, error: false },
    });
    const steps = characterSteps(i);
    expect(steps.name).toEqual({ status: "locked", note: NAME_LOCKED_NOTE });
    expect(NAME_LOCKED_NOTE).toBe("Prove you are one human first, then pick your name.");
    // The locked name is walked past; the human proof is what gets offered.
    expect(currentStep(steps, gatePassed(i), none, false)).toBe("sensor");
    expect(currentStep(steps, gatePassed(i), new Set(["sensor"]), false)).toBe("human");
  });

  it("does not lock the name once the human step is done, or with World off", () => {
    expect(characterSteps(inputs({ world: { lane: "on", human: "verified" } })).name).toEqual({
      status: "todo",
    });
    const worldOff = inputs({
      world: { lane: "off", human: "unknown" },
      access: { status: "approved", isAdmin: false, loading: false, error: false },
    });
    expect(characterSteps(worldOff).name).toEqual({ status: "todo" });
  });

  it("keeps a name claimed before the lock as done", () => {
    const i = inputs({ ens: { lane: "on", name: "dre.gohealthme.eth" } });
    expect(characterSteps(i).name).toEqual({ status: "done", summary: "dre.gohealthme.eth" });
  });

  it("says challenge, never run, in the step copy (one vocabulary, 2026-09-27)", () => {
    const human = characterSteps(inputs({ world: { lane: "on", human: "verified" } })).human;
    expect(human).toEqual({ status: "done", summary: "Verified human, one entry per challenge" });
    const sensor = characterSteps(inputs({ sensor: { kind: "unreadable", label: "WHOOP" } })).sensor;
    expect(sensor).toEqual({
      status: "waiting",
      note: "Your WHOOP is linked, and SPOTTER cannot read what it measures right now. Wearable challenges stay locked until it can.",
    });
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

// The gate wraps every signed-in page. Whether it shows character creation must
// come from the player's real state, not a per-browser flag: a player who made
// their character on a phone opens the laptop and plays.
describe("creationBlocks (the page gate)", () => {
  const none = new Set<never>();
  const complete = inputs({
    world: { lane: "on", human: "verified" },
    ens: { lane: "on", name: "dre.gohealthme.eth" },
    sensor: {
      kind: "paired",
      device: { provider: "junction", label: "Junction", metrics: ["steps"] },
    },
  });

  it("lets a complete player through on a new device with empty storage", () => {
    expect(
      creationBlocks({
        steps: characterSteps(complete),
        gate: gatePassed(complete),
        skipped: none,
        onboarded: false,
        creatingHere: false,
      }),
    ).toBe(false);
  });

  it("lets a returning player through when the wearable needs a re-check on this device", () => {
    const i = inputs({
      world: { lane: "on", human: "verified" },
      ens: { lane: "on", name: "dre.gohealthme.eth" },
      sensor: { kind: "unchecked" },
    });
    expect(
      creationBlocks({
        steps: characterSteps(i),
        gate: gatePassed(i),
        skipped: none,
        onboarded: false,
        creatingHere: false,
      }),
    ).toBe(false);
  });

  it("lets through a player who skipped the soft steps on another device", () => {
    const i = inputs({ world: { lane: "on", human: "verified" } });
    expect(
      creationBlocks({
        steps: characterSteps(i),
        gate: gatePassed(i),
        skipped: none,
        onboarded: false,
        creatingHere: false,
      }),
    ).toBe(false);
  });

  it("holds a player whose hard step is not done, whatever the local flag says", () => {
    const signedOut = inputs({ authenticated: false, address: null });
    expect(
      creationBlocks({
        steps: characterSteps(signedOut),
        gate: gatePassed(signedOut),
        skipped: none,
        onboarded: true,
        creatingHere: false,
      }),
    ).toBe(true);
    const unverified = inputs();
    expect(
      creationBlocks({
        steps: characterSteps(unverified),
        gate: gatePassed(unverified),
        skipped: new Set(["name", "sensor"]),
        onboarded: true,
        creatingHere: true,
      }),
    ).toBe(true);
  });

  it("keeps a brand-new player in the onboarding pass until they finish or skip it", () => {
    const i = inputs({ world: { lane: "on", human: "verified" } });
    const base = { steps: characterSteps(i), gate: gatePassed(i), creatingHere: true };
    expect(creationBlocks({ ...base, skipped: new Set(), onboarded: false })).toBe(true);
    expect(
      creationBlocks({ ...base, skipped: new Set(["name", "sensor"]), onboarded: false }),
    ).toBe(true);
    expect(creationBlocks({ ...base, skipped: new Set(), onboarded: true })).toBe(false);
  });
});

describe("hardGateClosed (is this player creating their character here)", () => {
  const settled = {
    authenticated: true,
    address: ADDRESS,
    gate: false,
    gateLoading: false,
    accessLoading: false,
    worldLane: "on" as const,
  };

  it("is true once every read has settled and the gate is closed", () => {
    expect(hardGateClosed(settled)).toBe(true);
  });

  it("is false while signed out, while a read is in flight, or once the gate is open", () => {
    expect(hardGateClosed({ ...settled, authenticated: false, address: null })).toBe(false);
    expect(hardGateClosed({ ...settled, gateLoading: true })).toBe(false);
    expect(hardGateClosed({ ...settled, accessLoading: true })).toBe(false);
    expect(hardGateClosed({ ...settled, worldLane: "loading" })).toBe(false);
    expect(hardGateClosed({ ...settled, gate: true })).toBe(false);
  });
});
