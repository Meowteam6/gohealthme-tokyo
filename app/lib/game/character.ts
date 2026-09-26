// Lane contract (docs/LANES.md): the character card every screen reads. Owned by
// the UX lane. Other lanes feed it through the APIs named in docs/LANES.md.
//
// Character creation happens once: sign in, prove you are one human, pick a
// name, pair a wearable. Every later screen reads the result instead of asking
// again, which is the whole point: the V3 flow interrogated the player at every
// pool (five separate join refusals), and each refusal arrived as a new screen.
//
// Pure and node-tested. The React hook that feeds it is lib/game/useCharacter.ts.
//
// Two of the four steps are HARD gates (the ones the server enforces anyway:
// a wallet, and either World proof-of-human or the closed-beta allowlist). The
// other two are soft: a player without a name plays under their short address,
// and a player without a wearable can browse the lobby and sees every wearable
// run locked with "pair your wearable" as the fix. Making them hard would be a new
// wall, which is the thing this module exists to remove.

import type { AccessStatus } from "@/lib/useAccess";
import type { LaneAvailability } from "@/lib/game/lanes";
import { countsLineFor, launchGoalLabels } from "@/lib/game/sensor-copy";
import {
  viewerMetricsOf,
  type ProviderOptions,
} from "@/lib/wearable-connect";

export type HumanStatus = "unknown" | "verified" | "unverified";

export interface CharacterDevice {
  provider: string;
  label: string;
  metrics: string[];
}

export interface Character {
  address: string;
  human: HumanStatus;
  name: string | null;
  device: CharacterDevice | null;
}

/**
 * Ready to enter a run: a verified human with a paired sensor. The name is
 * deliberately NOT required; it is how friends find you, not what makes a claim
 * verifiable, and requiring it would put a wall in front of the stake.
 */
export function isReadyToPlay(c: Character): boolean {
  return c.human === "verified" && c.device !== null;
}

// ------------------------------------------------------------------ sensor

/** What character creation knows about the player's sensor. */
export type SensorRead =
  /** The capability read is in flight. */
  | { kind: "loading" }
  /** A wallet is connected and no signature is cached to read with. One tap
   *  answers it; the tab-scoped signature cache is why returning players land
   *  here after a reload. */
  | { kind: "unchecked" }
  /** Read fine, nothing linked. */
  | { kind: "none" }
  /** Linked, and SPOTTER could not establish what it measures right now. */
  | { kind: "unreadable"; label: string }
  /** Linked and readable. */
  | { kind: "paired"; device: CharacterDevice }
  /** The read itself failed. */
  | { kind: "unavailable" };

/**
 * The sensor state from the provider-options read the join gate already uses
 * (lib/wearable-connect.ts), so pairing and the lobby can never disagree about
 * what a device measures.
 */
export function sensorFromOptions(
  options: ProviderOptions | undefined,
  loading: boolean,
): SensorRead {
  if (options === undefined) return loading ? { kind: "loading" } : { kind: "unavailable" };
  if (options.status === "unauthenticated") return { kind: "unchecked" };
  if (options.status === "unavailable") return { kind: "unavailable" };
  const active = options.providers.find((p) => p.id === options.selected);
  const metrics = viewerMetricsOf(options);
  if (metrics === null) {
    if (
      active !== undefined &&
      active.configured &&
      active.connected &&
      active.capability === "unknown"
    ) {
      return { kind: "unreadable", label: active.label };
    }
    return { kind: "none" };
  }
  return {
    kind: "paired",
    device: {
      provider: active?.id ?? "unknown",
      label: active?.label ?? "Your wearable",
      metrics: [...metrics],
    },
  };
}

/** The run goals a device can play, in words, for the character card. Only
 *  launch goals: a metric no run is scored on (sleep score) is not a goal. */
export function measurableGoalsOf(device: CharacterDevice): string[] {
  return launchGoalLabels(device.metrics);
}

// ------------------------------------------------------------------- steps

export type StepId = "sign-in" | "human" | "name" | "sensor";

export const STEP_ORDER: StepId[] = ["sign-in", "human", "name", "sensor"];

export type StepState =
  | { status: "done"; summary: string }
  | { status: "todo" }
  /** Something is probably there and one signature would tell (a sensor after
   *  a reload). Never a wall: the lobby shows the same one-tap check. */
  | { status: "check" }
  | { status: "loading" }
  /** Waiting on something the player cannot speed up (allowlist review). */
  | { status: "waiting"; note: string }
  /** This lane is not switched on for this build; the flow walks past it. */
  | { status: "off"; note: string }
  /** The read failed; the step offers a retry. */
  | { status: "error"; note: string }
  /** Waits on an earlier step; the note says which. Never a button that
   *  fails after the tap. */
  | { status: "locked"; note: string };

/** Shown on step 3 while World is on and step 2 is not done. The server
 *  refuses the claim with the same line (lib/server/ens/human-gate.ts). */
export const NAME_LOCKED_NOTE = "Prove you are one human first, then pick your name.";

/** How step 2 is satisfied on this deployment. */
export type HumanMode = "world" | "allowlist";

/** How step 3 is satisfied on this deployment. */
export type NameMode = "ens" | "handle";

export interface CharacterInputs {
  ready: boolean;
  authenticated: boolean;
  address: string | null;
  access: {
    status: AccessStatus;
    isAdmin: boolean;
    loading: boolean;
    error: boolean;
  };
  world: { lane: LaneAvailability | "loading"; human: HumanStatus };
  ens: { lane: LaneAvailability | "loading"; name: string | null };
  /** The existing off-chain @handle, the name fallback when ENS is off. */
  handle: string | null;
  sensor: SensorRead;
}

export function humanModeOf(i: CharacterInputs): HumanMode {
  return i.world.lane === "on" ? "world" : "allowlist";
}

export function nameModeOf(i: CharacterInputs): NameMode {
  return i.ens.lane === "on" ? "ens" : "handle";
}

/**
 * The hard gate, evaluated once. Signed in, and one of: an admin, an approved
 * allowlist entry, or a World-verified human. This is the same bar the
 * closed-beta gate used, with World as the self-serve way past it, so a
 * deployment without the World lane behaves exactly as V3 did (no new dead
 * end, and no dev-only skip).
 */
export function gatePassed(i: CharacterInputs): boolean {
  if (!i.authenticated || i.address === null) return false;
  if (i.access.isAdmin || i.access.status === "approved") return true;
  return i.world.lane === "on" && i.world.human === "verified";
}

function humanStep(i: CharacterInputs): StepState {
  if (i.world.lane === "loading") return { status: "loading" };
  if (i.world.lane === "on") {
    if (i.world.human === "verified") {
      return { status: "done", summary: "Verified human, one entry per run" };
    }
    // The allowlist still counts as a way in: an approved pilot player keeps
    // their access, and the World step shows as the upgrade, not a wall.
    return { status: "todo" };
  }
  // World is off (lane missing, unconfigured, or unreachable): the closed-beta
  // allowlist is the step, exactly as it worked before V4.
  if (i.access.isAdmin) return { status: "done", summary: "Admin" };
  if (i.access.loading) return { status: "loading" };
  if (i.access.error) {
    return { status: "error", note: "SPOTTER could not check the list just now." };
  }
  if (i.access.status === "approved") {
    return { status: "done", summary: "On the list" };
  }
  if (i.access.status === "pending") {
    return {
      status: "waiting",
      note: "Your request is in. You get in as soon as it is approved.",
    };
  }
  return { status: "todo" };
}

function nameStep(i: CharacterInputs): StepState {
  if (i.ens.lane === "loading") return { status: "loading" };
  if (i.ens.lane === "on") {
    if (i.ens.name !== null) return { status: "done", summary: i.ens.name };
    // Names cost GoHealthMe gas, so the server mints one only for a verified
    // human while World is on. Say so here, before any signature.
    if (i.world.lane === "loading") return { status: "loading" };
    if (i.world.lane === "on" && i.world.human !== "verified") {
      return { status: "locked", note: NAME_LOCKED_NOTE };
    }
    return { status: "todo" };
  }
  // ENS is off on this build: the existing @handle claim is the name.
  return i.handle !== null
    ? { status: "done", summary: `@${i.handle}` }
    : { status: "todo" };
}

function sensorStep(i: CharacterInputs): StepState {
  switch (i.sensor.kind) {
    case "loading":
      return { status: "loading" };
    case "paired":
      return {
        status: "done",
        summary: `${i.sensor.device.label}. ${countsLineFor(i.sensor.device.metrics)}`,
      };
    case "none":
      return { status: "todo" };
    case "unchecked":
      return { status: "check" };
    case "unreadable":
      return {
        status: "waiting",
        note: `Your ${i.sensor.label} is linked, and SPOTTER cannot read what it measures right now. Wearable runs stay locked until it can.`,
      };
    case "unavailable":
      return {
        status: "error",
        note: "SPOTTER could not reach the wearable check just now.",
      };
  }
}

export function characterSteps(i: CharacterInputs): Record<StepId, StepState> {
  const signedIn = i.authenticated && i.address !== null;
  return {
    "sign-in": !i.ready
      ? { status: "loading" }
      : signedIn
        ? { status: "done", summary: "Signed in" }
        : { status: "todo" },
    human: signedIn ? humanStep(i) : { status: "todo" },
    name: signedIn ? nameStep(i) : { status: "todo" },
    sensor: signedIn ? sensorStep(i) : { status: "todo" },
  };
}

/** Hard steps must be done before anything else renders. */
export const HARD_STEPS: StepId[] = ["sign-in", "human"];

/**
 * The step character creation should show, or null when there is nothing to
 * show. Hard steps come first and cannot be skipped. Soft steps are an
 * onboarding pass shown once, on the device where the player is made (see
 * creationBlocks): after the player finishes or skips
 * them (`onboarded`), creation never interrupts again and the lobby carries
 * any lock that is left, with its fix, on the run it affects.
 */
export function currentStep(
  steps: Record<StepId, StepState>,
  gate: boolean,
  skipped: ReadonlySet<StepId>,
  onboarded: boolean,
): StepId | null {
  if (steps["sign-in"].status !== "done") return "sign-in";
  if (!gate) return "human";
  if (onboarded) return null;
  for (const id of STEP_ORDER) {
    if (HARD_STEPS.includes(id)) continue;
    if (steps[id].status === "done" || steps[id].status === "locked" || skipped.has(id)) continue;
    return id;
  }
  // A World-on build where the player got in through the allowlist: offer the
  // proof once, skippably, because one-human-one-entry is checked at the join.
  if (steps.human.status === "todo" && !skipped.has("human")) return "human";
  return null;
}

/**
 * True when this device has watched a signed-in player stand at a closed hard
 * gate with every read settled: they are making their character here, right
 * now, so the onboarding pass should follow the hard steps. A returning player
 * (any device) arrives with the gate already open and never trips this.
 */
export function hardGateClosed(v: {
  authenticated: boolean;
  address: string | null;
  gate: boolean;
  gateLoading: boolean;
  accessLoading: boolean;
  worldLane: LaneAvailability | "loading";
}): boolean {
  if (!v.authenticated || v.address === null) return false;
  if (v.gate || v.gateLoading || v.accessLoading) return false;
  return v.worldLane !== "loading";
}

/**
 * Whether the page gate shows character creation instead of the page. The hard
 * steps always hold. Past them, the player's real state decides, never the
 * per-device onboarding flag alone: a player who finished or skipped the soft
 * steps on another device walks straight in here. Only a player creating
 * their character on this device (`creatingHere`) is walked through the soft
 * pass, once, until they finish it or skip what is left.
 */
export function creationBlocks(g: {
  steps: Record<StepId, StepState>;
  gate: boolean;
  skipped: ReadonlySet<StepId>;
  onboarded: boolean;
  creatingHere: boolean;
}): boolean {
  if (!g.gate || g.steps["sign-in"].status !== "done") return true;
  if (g.onboarded || !g.creatingHere) return false;
  return true;
}

/** The character the rest of the app reads. */
export function characterOf(i: CharacterInputs): Character | null {
  if (!i.authenticated || i.address === null) return null;
  const human: HumanStatus =
    i.world.lane === "on"
      ? i.world.human
      : i.access.isAdmin || i.access.status === "approved"
        ? "verified"
        : i.access.loading
          ? "unknown"
          : "unverified";
  const name =
    i.ens.lane === "on"
      ? i.ens.name
      : i.handle !== null
        ? `@${i.handle}`
        : null;
  return {
    address: i.address,
    human,
    name,
    device: i.sensor.kind === "paired" ? i.sensor.device : null,
  };
}
