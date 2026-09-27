import { describe, it, expect } from "vitest";
import {
  coachChecklist,
  coachCopy,
  resolveCoachStep,
  type CoachAction,
  type CoachInputs,
} from "@/lib/help/coach";
import type { StepId, StepState } from "@/lib/game/character";

const DONE: StepState = { status: "done", summary: "ok" };
const TODO: StepState = { status: "todo" };

function inputs(
  steps: Partial<Record<StepId, StepState>> = {},
  humanMode: CoachInputs["humanMode"] = "world",
): CoachInputs {
  return {
    steps: {
      "sign-in": DONE,
      human: DONE,
      name: DONE,
      sensor: DONE,
      ...steps,
    },
    humanMode,
  };
}

describe("resolveCoachStep follows character creation", () => {
  it("starts at sign in for a signed-out visitor", () => {
    const step = resolveCoachStep(
      inputs({ "sign-in": TODO, human: TODO, name: TODO, sensor: TODO }),
    );
    expect(step.id).toBe("signIn");
    expect(step.index).toBe(0);
  });

  it("walks sign in, prove human, pick a name, pair a sensor, enter a run", () => {
    const order: CoachAction[] = [];
    const states: Partial<Record<StepId, StepState>>[] = [
      { "sign-in": TODO, human: TODO, name: TODO, sensor: TODO },
      { human: TODO, name: TODO, sensor: TODO },
      { name: TODO, sensor: TODO },
      { sensor: TODO },
      {},
    ];
    for (const s of states) order.push(resolveCoachStep(inputs(s)).id);
    expect(order).toEqual([
      "signIn",
      "proveHuman",
      "pickName",
      "pairSensor",
      "enterRun",
    ]);
  });

  it("holds on a loading step instead of skipping ahead", () => {
    const step = resolveCoachStep(inputs({ human: { status: "loading" } }));
    expect(step.id).toBe("proveHuman");
    expect(step.loading).toBe(true);
  });

  it("walks past a lane that is off for this build", () => {
    const step = resolveCoachStep(
      inputs({ name: { status: "off", note: "names are off" }, sensor: TODO }),
    );
    expect(step.id).toBe("pairSensor");
  });

  it("carries the allowlist wait and a read error to the widget", () => {
    expect(
      resolveCoachStep(inputs({ human: { status: "waiting", note: "in review" } }))
        .waiting,
    ).toBe("in review");
    expect(
      resolveCoachStep(inputs({ sensor: { status: "error", note: "read failed" } }))
        .error,
    ).toBe("read failed");
  });

  it("respects a skipped name or sensor, never a skipped hard step", () => {
    const skipped = new Set<StepId>(["name", "human"]);
    expect(
      resolveCoachStep({ ...inputs({ name: TODO, sensor: TODO }), skipped }).id,
    ).toBe("pairSensor");
    expect(
      resolveCoachStep({ ...inputs({ human: TODO }), skipped }).id,
    ).toBe("proveHuman");
  });

  it("treats an unread sensor as the sensor step, not as paired", () => {
    const step = resolveCoachStep(inputs({ sensor: { status: "check" } }));
    expect(step.id).toBe("pairSensor");
  });
});

describe("coach copy", () => {
  it("labels the human step by how this build runs it", () => {
    expect(coachChecklist("world")[1].label).toBe("Prove you are human");
    expect(coachChecklist("allowlist")[1].label).toBe("Get your spot");
  });

  it("keeps six rows with only the payout row in gold", () => {
    const rows = coachChecklist("world");
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.gold === true).map((r) => r.id)).toEqual(["paid"]);
  });

  it("never promises an instant payout, an enclave, or Arc gas", () => {
    const actions: CoachAction[] = [
      "signIn",
      "proveHuman",
      "pickName",
      "pairSensor",
      "enterRun",
    ];
    for (const mode of ["world", "allowlist"] as const) {
      for (const id of actions) {
        const copy = coachCopy(id, mode);
        const text = `${copy.headline} ${copy.body} ${copy.primary ?? ""} ${copy.secondary ?? ""}`;
        expect(text).not.toMatch(/instant|the moment|enclave|\bArc\b|!/i);
      }
    }
  });

  it("says challenge, never run, pool or dare, and names the one create flow", () => {
    const actions: CoachAction[] = ["signIn", "proveHuman", "pickName", "pairSensor", "enterRun"];
    for (const mode of ["world", "allowlist"] as const) {
      for (const row of coachChecklist(mode)) {
        expect(row.label).not.toMatch(/\b(runs?|pools?|dares?)\b/i);
      }
      for (const id of actions) {
        const copy = coachCopy(id, mode);
        const text = `${copy.headline} ${copy.body} ${copy.primary ?? ""} ${copy.secondary ?? ""}`;
        expect(text).not.toMatch(/\b(runs?|pools?|dares?)\b/i);
      }
    }
    expect(coachChecklist("world")[4].label).toBe("Join a challenge");
    expect(coachCopy("enterRun", "world").secondary).toBe("Start a challenge");
  });
});
