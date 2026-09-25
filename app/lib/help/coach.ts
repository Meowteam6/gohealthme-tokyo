// The onboarding coach's state machine. Pure and client-safe: no hooks, no
// network, no LLM. It reads the character-creation steps the gate already
// computes (lib/game/character.ts: sign in, prove human, pick a name, pair a
// sensor) and returns the SINGLE next step to surface, then "enter a run" once
// the player exists. The widget wires the returned step to a real handler
// (sign-in panel, route, re-read); this module only decides which step is
// current, so the decision is unit-testable in isolation.
//
// It must never disagree with character creation. Same steps, same order,
// same meaning of done: a coach that said "claim a handle" while the name step
// ran ENS, or "get test USDC" before the player could even stake, sent people
// down a path the product no longer has.
//
// Reliability over cleverness: first match wins, there is exactly one current
// step, and a step that is still loading holds instead of skipping ahead.

import type { HumanMode, StepId, StepState } from "@/lib/game/character";

/** The actionable steps, in order. `paid` is the terminal goal, never current. */
export type CoachAction =
  | "signIn"
  | "proveHuman"
  | "pickName"
  | "pairSensor"
  | "enterRun";

export interface CoachInputs {
  steps: Record<StepId, StepState>;
  humanMode: HumanMode;
  /** Steps the player skipped in character creation (lib/game/onboarding-
   *  store). Only the soft steps (name, sensor) can be skipped; the hard
   *  steps are never walked past on a skip. */
  skipped?: ReadonlySet<StepId>;
}

const SKIPPABLE: ReadonlySet<StepId> = new Set<StepId>(["name", "sensor"]);

export interface CoachStep {
  id: CoachAction;
  /** Position in the checklist (0..4). */
  index: number;
  /** The step is still being read: hold it, do not advance or fire. */
  loading: boolean;
  /** The read failed; the primary action becomes a retry. */
  error: string | null;
  /** Waiting on something the player cannot speed up (allowlist review). */
  waiting: string | null;
}

const ORDER: { step: StepId; action: CoachAction }[] = [
  { step: "sign-in", action: "signIn" },
  { step: "human", action: "proveHuman" },
  { step: "name", action: "pickName" },
  { step: "sensor", action: "pairSensor" },
];

/** A step the flow walks past: finished, or switched off for this build. */
function passed(state: StepState): boolean {
  return state.status === "done" || state.status === "off";
}

/**
 * The current step: the first character step that is not done (or off for
 * this build), else enterRun. A loading step holds with loading true so the
 * widget pulses instead of flashing a later step.
 */
export function resolveCoachStep(input: CoachInputs): CoachStep {
  for (let index = 0; index < ORDER.length; index += 1) {
    const { step, action } = ORDER[index];
    const state = input.steps[step];
    if (passed(state)) continue;
    if (SKIPPABLE.has(step) && input.skipped?.has(step) === true) continue;
    return {
      id: action,
      index,
      loading: state.status === "loading",
      error: state.status === "error" ? state.note : null,
      waiting: state.status === "waiting" ? state.note : null,
    };
  }
  return {
    id: "enterRun",
    index: ORDER.length,
    loading: false,
    error: null,
    waiting: null,
  };
}

export interface ChecklistRow {
  id: CoachAction | "paid";
  label: string;
  /** The payout row wears gold - the only gold in the widget. */
  gold?: boolean;
}

/** Always six rows, always the same order as character creation. */
export function coachChecklist(humanMode: HumanMode): ChecklistRow[] {
  return [
    { id: "signIn", label: "Sign in" },
    {
      id: "proveHuman",
      label: humanMode === "world" ? "Prove you are human" : "Get your spot",
    },
    { id: "pickName", label: "Pick a name" },
    { id: "pairSensor", label: "Pair your sensor" },
    { id: "enterRun", label: "Enter a run" },
    { id: "paid", label: "Get paid", gold: true },
  ];
}

export interface CoachCopy {
  headline: string;
  body: string;
  /** Absent for signIn, which renders the sign-in panel instead. */
  primary?: string;
  /** Only the skippable steps and enterRun offer a second path. */
  secondary?: string;
}

/** Scripted copy per step. GoHealthMe voice: direct, no emoji, no exclamations. */
export function coachCopy(id: CoachAction, humanMode: HumanMode): CoachCopy {
  switch (id) {
    case "signIn":
      return {
        headline: "Start here",
        body: "Sign in with an email address. We make the wallet for you: no seed phrase, no extension, nothing to install.",
      };
    case "proveHuman":
      return humanMode === "world"
        ? {
            headline: "Prove you are one human",
            body: "One scan with World ID. One human, one entry per run. We never see your face or your name, just a yes.",
            primary: "Prove I am human",
          }
        : {
            headline: "Get your spot",
            body: "The beta is invite-only on this build. Ask for a spot and you are in once it is approved.",
            primary: "Ask for a spot",
          };
    case "pickName":
      return {
        headline: "Pick a name",
        body: "So friends and the payout feed show a name, not a wallet address. Optional. Your health data stays private either way.",
        primary: "Pick a name",
        secondary: "Skip for now",
      };
    case "pairSensor":
      return {
        headline: "Pair your sensor",
        body: "Your wearable is the referee. Once it is paired, the lobby shows which runs it can actually measure before you stake anything.",
        primary: "Pair my sensor",
        secondary: "Look at the runs first",
      };
    case "enterRun":
      return {
        headline: "Now pick a run",
        body: "Stake test USDC on yourself, bank your nights, and SPOTTER pays when the run settles. Or dare a friend.",
        primary: "Open the lobby",
        secondary: "Dare a friend",
      };
  }
}
