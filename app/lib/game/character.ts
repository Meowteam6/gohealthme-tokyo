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
import { launchGoalLabels } from "@/lib/game/sensor-copy";
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

/** How a verified human proved it: World ID, the closed-beta list, or the
 *  admin allowlist. */
export type HumanProof = "world" | "list" | "admin";

export interface Character {
  address: string;
  human: HumanStatus;
  /** How `human` was proven; null while unproven. Optional so fixtures built
   *  before 2026-09-30 still type (the stamp then falls back to the mode). */
  humanProof?: HumanProof | null;
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
  if (metrics === null || metrics.length === 0) {
    // Linked but nothing readable yet: a capability SPOTTER cannot establish,
    // or a fresh Junction link before its first sync. Both are "linked and
    // waiting", never "nothing linked": the second reading left a paired
    // player stuck on step 4 with "no wearable paired" (2026-09-27).
    if (active !== undefined && active.configured && active.connected) {
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

/** Shown on step 3 to a player who got in through the list while World is
 *  on: names are minted one per World ID human (lib/server/ens/human-gate.ts),
 *  so the list alone does not carry one. Optional; they play under their
 *  short wallet address, and step 2 offers World ID for it. */
export const NAME_NEEDS_WORLD_NOTE =
  "Names come with World ID, one per human. Add World ID in step 2 to pick one.";

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
 * How this player is a proven human, or null. World ID when the lane is on
 * and the wallet verified; otherwise an admin, or an approved list entry.
 * The list counts on a World-on build too (Andre, 2026-09-30): character
 * creation offers "No World ID? Ask for a spot on the list instead", and an
 * approved list player used to get in and then find every challenge locked
 * "prove you are one human". The server agrees (lib/server/world/
 * require-human.ts). World stays the self-serve way in.
 */
export function humanProofOf(i: CharacterInputs): HumanProof | null {
  if (i.world.lane === "on" && i.world.human === "verified") return "world";
  if (i.access.isAdmin) return "admin";
  if (i.access.status === "approved") return "list";
  return null;
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
      return { status: "done", summary: "Verified human, one entry per challenge" };
    }
    // The list is a way in on a World-on build too, and it counts as the
    // human step (humanProofOf): nothing re-asks an admin or an approved
    // list player to prove anything.
    if (i.access.isAdmin) return { status: "done", summary: "Admin" };
    if (i.access.status === "approved") return { status: "done", summary: "On the list" };
    if (i.access.status === "pending") {
      return {
        status: "waiting",
        note: "Your request is in. You get in as soon as it is approved, or right now with World ID.",
      };
    }
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
    // Names cost GoHealthMe gas, so the server mints one only for a World
    // verified human while World is on. Say so here, before any signature.
    if (i.world.lane === "loading") return { status: "loading" };
    if (i.world.lane === "on" && i.world.human !== "verified") {
      const listed = i.access.isAdmin || i.access.status === "approved";
      return { status: "locked", note: listed ? NAME_NEEDS_WORLD_NOTE : NAME_LOCKED_NOTE };
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
        summary: i.sensor.device.label,
      };
    case "none":
      return { status: "todo" };
    case "unchecked":
      return { status: "check" };
    case "unreadable":
      return {
        status: "waiting",
        note: `Your ${i.sensor.label} is linked, and SPOTTER cannot read what it measures right now. Wearable challenges stay locked until it can.`,
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
  // Safety net: a passed gate with step 2 still to do is offered once,
  // skippably. Since the list counts as the human step (humanProofOf,
  // 2026-09-30) a passed gate always has step 2 done, so this no longer
  // re-asks a list player for World ID.
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

/** The character the rest of the app reads. A proven human by World ID, the
 *  list or the admin allowlist (humanProofOf); "unknown" while a read that
 *  could still prove it is in flight, so the join holds on a skeleton instead
 *  of flashing "prove you are one human" at a list player. */
export function characterOf(i: CharacterInputs): Character | null {
  if (!i.authenticated || i.address === null) return null;
  const humanProof = humanProofOf(i);
  const worldPending = i.world.lane === "on" && i.world.human === "unknown";
  const human: HumanStatus =
    humanProof !== null
      ? "verified"
      : i.access.loading || worldPending
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
    humanProof,
    name,
    device: i.sensor.kind === "paired" ? i.sensor.device : null,
  };
}

/**
 * The stamp beside the player's name, or null when unproven: "One human" for
 * World ID, "On the list" for the list and the admins. A character built
 * without `humanProof` (older fixtures) falls back to the build's mode.
 */
export function humanStampOf(c: Character, mode: HumanMode): string | null {
  if (c.human !== "verified") return null;
  const proof = c.humanProof ?? (mode === "world" ? "world" : "list");
  return proof === "world" ? "One human" : "On the list";
}
