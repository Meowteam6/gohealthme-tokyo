"use client";

import { GallerySection, StateFrame, type SectionProps } from "../_kit";
import CharacterCreation from "@/components/game/CharacterCreation";
import { GateLoading } from "@/components/AccessGate";
import type { CharacterView } from "@/lib/game/useCharacter";
import type { Onboarding } from "@/lib/game/onboarding-store";
import type { StepId, StepState } from "@/lib/game/character";
import { NAME_LOCKED_NOTE } from "@/lib/game/character";
import type { ProviderOptions } from "@/lib/wearable-connect";

// Character creation states for the dev gallery: the real CharacterCreation
// with fixture views. Nothing here reads a wallet; every callback is a no-op.

const ADDRESS = "0x8a39c0ffee000000000000000000000000006141" as const satisfies `0x${string}`;
const noop = () => {};

const PROVIDERS: ProviderOptions = {
  status: "known",
  selected: null,
  providers: [
    { id: "junction", label: "Junction", configured: true, connected: false, metrics: ["sleep_hours", "workouts", "steps"], observedMetrics: null, capability: "declared" },
    { id: "whoop", label: "WHOOP", configured: true, connected: false, metrics: ["sleep_hours", "workouts"], observedMetrics: null, capability: "declared" },
    { id: "apple", label: "Apple Health", configured: false, connected: false, metrics: ["sleep_hours", "workouts", "steps"], observedMetrics: null, capability: "declared" },
  ],
} as unknown as ProviderOptions;

const WHOOP_PAIRED: ProviderOptions = {
  ...PROVIDERS,
  selected: "whoop",
  providers: PROVIDERS.providers.map((p) =>
    p.id === "whoop" ? { ...p, connected: true, capability: "declared" } : p,
  ),
} as ProviderOptions;

function view(over: {
  signedIn?: boolean;
  gate?: boolean;
  steps?: Partial<Record<StepId, StepState>>;
  humanMode?: CharacterView["humanMode"];
  accessStatus?: "none" | "pending" | "approved" | "denied";
  sensor?: CharacterView["sensor"];
  providers?: ProviderOptions;
  name?: string | null;
}): CharacterView {
  const signedIn = over.signedIn ?? true;
  const steps: Record<StepId, StepState> = {
    "sign-in": signedIn ? { status: "done", summary: "mika@example.com" } : { status: "todo" },
    human: { status: "todo" },
    name: { status: "todo" },
    sensor: { status: "todo" },
    ...over.steps,
  };
  const sensor = over.sensor ?? { kind: "none" };
  return {
    ready: true,
    authenticated: signedIn,
    address: signedIn ? ADDRESS : null,
    character: signedIn
      ? {
          address: ADDRESS,
          human: steps.human.status === "done" ? "verified" : "unverified",
          name: over.name ?? null,
          device: sensor.kind === "paired" ? sensor.device : null,
        }
      : null,
    steps,
    gate: over.gate ?? false,
    gateLoading: false,
    humanMode: over.humanMode ?? "world",
    nameMode: "ens",
    worldLane: "on",
    ensLane: "on",
    sensor,
    providers: over.providers ?? PROVIDERS,
    access: {
      loading: false,
      error: false,
      status: over.accessStatus ?? "none",
      isAdmin: false,
      authenticated: signedIn,
      address: signedIn ? ADDRESS : null,
      refetch: noop,
    },
    checkSensor: async () => false,
    checkingSensor: false,
    refresh: noop,
  };
}

function onboarding(skipped: StepId[] = [], done = false): Onboarding {
  return {
    skipped: new Set(skipped),
    done,
    hydrated: true,
    skip: noop,
    finish: noop,
    reopen: noop,
  };
}

const HUMAN_DONE: StepState = { status: "done", summary: "Verified with World ID" };
const NAME_DONE: StepState = { status: "done", summary: "mika.gohealthme.eth" };
const WHOOP = { provider: "whoop", label: "WHOOP", metrics: ["sleep_score", "sleep_efficiency", "sleep_hours", "workouts", "active_calories"] };

export default function OnboardingStates({ meta }: SectionProps) {
  return (
    <GallerySection meta={meta}>
      <StateFrame name="character-loading" note="the gate reading the player before anything renders">
        <GateLoading />
      </StateFrame>
      <StateFrame name="character-sign-in" note="step 1, signed out: email code makes the wallet">
        <CharacterCreation view={view({ signedIn: false })} onboarding={onboarding()} mode="gate" />
      </StateFrame>
      <StateFrame name="character-world-id" note="step 2, World on: one scan, the hard gate">
        <CharacterCreation view={view({})} onboarding={onboarding()} mode="gate" />
      </StateFrame>
      <StateFrame name="character-allowlist-pending" note="step 2, World off: the request is waiting on Andre">
        <CharacterCreation
          view={view({ humanMode: "allowlist", accessStatus: "pending", steps: { human: { status: "waiting", note: "Waiting on approval" } } })}
          onboarding={onboarding()}
          mode="gate"
        />
      </StateFrame>
      <StateFrame name="character-name" note="step 3 open after the World scan">
        <CharacterCreation
          view={view({ gate: true, steps: { human: HUMAN_DONE } })}
          onboarding={onboarding()}
          mode="gate"
        />
      </StateFrame>
      <StateFrame name="character-name-locked" note="/character?step=name before step 2: the name-lock line">
        <CharacterCreation
          view={view({ gate: true, humanMode: "allowlist", steps: { human: { status: "todo" }, name: { status: "locked", note: NAME_LOCKED_NOTE } } })}
          onboarding={onboarding()}
          focus="name"
          mode="page"
        />
      </StateFrame>
      <StateFrame name="character-wearable" note="step 4: every option says what it measures; Apple says it cannot pair yet">
        <CharacterCreation
          view={view({ gate: true, steps: { human: HUMAN_DONE, name: NAME_DONE } })}
          onboarding={onboarding()}
          mode="gate"
        />
      </StateFrame>
      <StateFrame name="character-wearable-paired" note="step 4 with WHOOP: the limit is named before any stake">
        <CharacterCreation
          view={view({
            gate: true,
            steps: { human: HUMAN_DONE, name: NAME_DONE, sensor: { status: "done", summary: "WHOOP" } },
            sensor: { kind: "paired", device: WHOOP },
            providers: WHOOP_PAIRED,
          })}
          onboarding={onboarding()}
          focus="sensor"
          mode="page"
        />
      </StateFrame>
      <StateFrame name="character-done" note="all four done: the card and the way in">
        <CharacterCreation
          view={view({
            gate: true,
            name: "mika.gohealthme.eth",
            steps: { human: HUMAN_DONE, name: NAME_DONE, sensor: { status: "done", summary: "WHOOP" } },
            sensor: { kind: "paired", device: WHOOP },
            providers: WHOOP_PAIRED,
          })}
          onboarding={onboarding()}
          mode="gate"
        />
      </StateFrame>
    </GallerySection>
  );
}
