"use client";

// Character creation: sign in, prove you are one human, pick your name, pair
// your wearable. Replaces the closed-beta wall. The steps are a real sequence,
// so they are numbered; the current one is open and the rest collapse to one
// line each with their result. SPOTTER stands on the riverbank above the
// steps in a new pose per step (docs/DESIGN.md, onboarding 1 to 4).
//
// The World, ENS and sensor steps mount the other lanes' components through
// their contracts (docs/LANES.md) and never assume the lane is on: a lane that
// is not on this build is said plainly and walked past, and with World off the
// allowlist request is the way in, exactly as before V4.

import { useState, type ReactNode } from "react";
import ProveHuman from "@/components/world/ProveHuman";
import EnsNameClaim from "@/components/ens/EnsNameClaim";
import ClaimHandle from "@/components/ClaimHandle";
import RequestAccess from "@/components/RequestAccess";
import Perch from "@/components/spotter/Perch";
import SpotterCaption from "@/components/spotter/SpotterCaption";
import { Button, Card, TAP_TARGET } from "@/components/ui";
import type { SpotterScreenState } from "@/lib/spotter-poses";
import CharacterCard from "@/components/game/CharacterCard";
import SignInStep from "@/components/game/SignInStep";
import SensorStep from "@/components/game/SensorStep";
import {
  STEP_ORDER,
  currentStep,
  type StepId,
  type StepState,
} from "@/lib/game/character";
import type { CharacterView } from "@/lib/game/useCharacter";
import type { Onboarding } from "@/lib/game/onboarding-store";

const TITLE: Record<StepId, string> = {
  "sign-in": "Sign in",
  human: "Prove you are one human",
  name: "Pick your name",
  sensor: "Pair your wearable",
};

const SPOTTER_LINE: Record<StepId, string> = {
  "sign-in": "Email in, wallet out. I do the crypto part.",
  human: "One human, one entry. I do not pay bots and I do not pay twins.",
  name: "Your boys should see a name on the board, not 0x-something.",
  sensor: "I only pay on what the wearable says. Show me what yours can see.",
};

const SCENE: Record<StepId, SpotterScreenState> = {
  "sign-in": "onboarding-welcome",
  human: "onboarding-world-id",
  name: "onboarding-name",
  sensor: "onboarding-wearable",
};

const DONE_LINE = "That is your player. Every run reads this card.";

/**
 * The riverbank over the steps. Phones get a compact scene (SPOTTER at 120px
 * beside his line) so the open step's action stays above the fold at 390x844;
 * from lg up he stands at hero size beside the steps.
 */
function Scene({ step, title }: { step: StepId | null; title: string }) {
  const state: SpotterScreenState =
    step !== null ? SCENE[step] : "onboarding-welcome";
  const line = step !== null ? SPOTTER_LINE[step] : DONE_LINE;
  return (
    <section className="relative lg:sticky lg:top-24">
      {/* SPOTTER stands on the card's top edge, a new pose per step; small on
          a phone so the open step's action stays in view. */}
      <Perch state={state} width={[88, 156]} side="right" priority decorative>
        <Card>
          <h1 className="type-title m-0 break-words text-[2.25rem] min-[900px]:text-[2.75rem]">
            {title}
          </h1>
          <p className="m-0 mt-2 max-w-md text-base text-muted">
            Four steps, once. Then every run reads this card. Base Sepolia test
            money only.
          </p>
          <SpotterCaption line={line} live className="mt-4" />
        </Card>
      </Perch>
    </section>
  );
}

function StatusText({
  state,
  skipped,
}: {
  state: StepState;
  skipped: boolean;
}) {
  if (state.status === "done") {
    return <span className="truncate font-semibold text-accent-deep">{state.summary}</span>;
  }
  if (skipped) return <span className="text-muted">Skipped</span>;
  switch (state.status) {
    case "loading":
      return <span className="text-muted">Checking</span>;
    case "waiting":
      return <span className="text-warning">Waiting</span>;
    case "off":
      return <span className="text-muted">Not on this build</span>;
    case "error":
      return <span className="text-warning">Not answering</span>;
    case "check":
      return <span className="text-muted">Not checked this visit</span>;
    case "todo":
      return <span className="text-muted">To do</span>;
    case "locked":
      return <span className="text-muted">Locked until step 2 is done</span>;
  }
}

function SkipLink({ onSkip, label = "Skip for now" }: { onSkip: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      className={`-ml-4 text-muted underline underline-offset-2 hover:text-foreground ${TAP_TARGET}`}
    >
      {label}
    </button>
  );
}

function HumanBody({
  view,
  onSkip,
}: {
  view: CharacterView;
  onSkip?: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [useList, setUseList] = useState(false);
  const address = view.address;
  if (address === null) return null;
  const state = view.steps.human;

  if (view.humanMode === "world" && !useList) {
    if (state.status === "done") {
      return <p className="text-sm">{state.summary}. It covers every run you enter.</p>;
    }
    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground/80">
          One scan with World ID proves a real, unique person is playing. I never
          see who you are, only that you are one human.
        </p>
        <ProveHuman
          address={address}
          onVerified={() => {
            setFailure(null);
            view.refresh();
          }}
          onFailed={(reason) => setFailure(reason)}
        />
        {failure !== null ? (
          <p role="alert" className="rounded-2xl border border-warning/50 bg-warning/5 p-3 text-sm">
            {failure} Nothing was recorded. You can try the scan again.
          </p>
        ) : null}
        {!view.gate ? (
          <button
            type="button"
            onClick={() => setUseList(true)}
            className={`-ml-4 text-sm text-muted underline underline-offset-2 hover:text-foreground ${TAP_TARGET}`}
          >
            No World ID? Ask for a spot on the list instead
          </button>
        ) : null}
        {onSkip !== undefined ? <SkipLink onSkip={onSkip} /> : null}
      </div>
    );
  }

  // The allowlist: World is not on this build, or the player chose the list.
  if (state.status === "waiting" || view.access.status === "pending") {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          Your request is in. You get in as soon as it is approved, and this
          page opens on its own when it is.
        </p>
        <Button type="button" variant="secondary" onClick={() => view.access.refetch()}>
          Check my spot
        </Button>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="space-y-3">
        <p className="text-sm">{state.note} Your spot is safe.</p>
        <Button type="button" variant="secondary" onClick={() => view.access.refetch()}>
          Check again
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {view.worldLane !== "on" ? (
        <p className="text-sm text-muted">
          World ID is not switched on for this build, so the list is the way in.
        </p>
      ) : null}
      <RequestAccess status={view.access.status} onSubmitted={view.access.refetch} />
    </div>
  );
}

function NameBody({
  view,
  onSkip,
  onProveHuman,
}: {
  view: CharacterView;
  onSkip?: () => void;
  onProveHuman: () => void;
}) {
  const address = view.address;
  if (address === null) return null;
  const state = view.steps.name;
  if (state.status === "locked") {
    // The server mints names for verified humans only while World is on.
    // Say so before any signature instead of offering a claim that fails.
    return (
      <div className="space-y-3">
        <p className="text-sm">{state.note}</p>
        <Button type="button" variant="secondary" onClick={onProveHuman}>
          Go to step 2
        </Button>
        <p className="text-xs text-muted">
          Optional. Without one you play under your short wallet address.
        </p>
        {onSkip !== undefined ? <SkipLink onSkip={onSkip} /> : null}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {view.nameMode === "ens" ? (
        <EnsNameClaim
          address={address}
          currentName={state.status === "done" ? state.summary : null}
          onClaimed={() => view.refresh()}
        />
      ) : (
        <>
          <p className="text-sm text-muted">
            ENS names are not switched on for this build, so your name is a
            GoHealthMe handle.
          </p>
          <ClaimHandle />
        </>
      )}
      <p className="text-xs text-muted">
        Optional. Without one you play under your short wallet address.
      </p>
      {onSkip !== undefined ? (
        <SkipLink onSkip={onSkip} label={state.status === "done" ? "Done" : "Skip for now"} />
      ) : null}
    </div>
  );
}

function StepBody({
  id,
  view,
  onSkip,
  onPick,
}: {
  id: StepId;
  view: CharacterView;
  onSkip?: () => void;
  onPick: (id: StepId) => void;
}): ReactNode {
  switch (id) {
    case "sign-in":
      return <SignInStep />;
    case "human":
      return <HumanBody view={view} onSkip={onSkip} />;
    case "name":
      return <NameBody view={view} onSkip={onSkip} onProveHuman={() => onPick("human")} />;
    case "sensor":
      return <SensorStep view={view} onSkip={onSkip} />;
  }
}

export default function CharacterCreation({
  view,
  onboarding,
  focus = null,
  mode,
}: {
  view: CharacterView;
  onboarding: Onboarding;
  /** A step the caller asked for (the lobby's fix links pass ?step=). */
  focus?: StepId | null;
  /** "gate": shown in place of a page until the hard steps pass and the
   *  onboarding pass is done. "page": the /character editor. */
  mode: "gate" | "page";
}) {
  const [picked, setPicked] = useState<StepId | null>(null);
  const current = currentStep(
    view.steps,
    view.gate,
    onboarding.skipped,
    mode === "page" ? false : onboarding.done,
  );
  const hardOpen = current === "sign-in" || (current === "human" && !view.gate);
  // Hard steps cannot be bypassed by picking another row.
  const open: StepId | null = hardOpen ? current : (picked ?? focus ?? current);
  const signedIn = view.steps["sign-in"].status === "done";

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 py-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:items-start lg:gap-10">
      <Scene step={open} title={mode === "page" ? "Your player" : "Make your player"} />

      <div className="min-w-0 space-y-6">
      <ol className="divide-y divide-edge overflow-hidden rounded-3xl border border-edge bg-surface">
        {STEP_ORDER.map((id, index) => {
          const state = view.steps[id];
          const isOpen = open === id;
          const canPick = signedIn && view.gate && !hardOpen && id !== "sign-in";
          const header = (
            <>
              <span
                aria-hidden="true"
                className={`num flex size-10 shrink-0 items-center justify-center rounded-full border-2 text-base font-bold ${
                  state.status === "done"
                    ? "border-moonlight/40 bg-moonlight/10 text-moonlight"
                    : isOpen
                      ? "border-transparent bg-accent text-accent-foreground"
                      : "border-edge bg-surface-raised text-muted"
                }`}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words font-display text-xl font-bold leading-tight tracking-display">
                  {TITLE[id]}
                </span>
                <span className="block truncate text-sm">
                  <StatusText state={state} skipped={onboarding.skipped.has(id)} />
                </span>
              </span>
            </>
          );
          return (
            <li key={id} aria-current={isOpen ? "step" : undefined}>
              {canPick && !isOpen ? (
                <button
                  type="button"
                  onClick={() => setPicked(id)}
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground"
                >
                  {header}
                </button>
              ) : (
                <div className="flex min-h-16 items-center gap-3 px-4 py-3">{header}</div>
              )}
              {isOpen ? (
                <div className="px-4 pb-5 sm:pl-16">
                  <StepBody
                    id={id}
                    view={view}
                    onPick={setPicked}
                    onSkip={
                      id === "name" || id === "sensor" || (id === "human" && view.gate)
                        ? () => {
                            onboarding.skip(id);
                            setPicked(null);
                          }
                        : undefined
                    }
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {signedIn && view.gate && current === null && mode === "gate" ? (
        <div className="space-y-3">
          <CharacterCard view={view} />
          <Button type="button" pop onClick={onboarding.finish} className="w-full">
            Take me in
          </Button>
        </div>
      ) : null}
      {signedIn && view.gate && mode === "page" ? <CharacterCard view={view} /> : null}
      </div>
    </div>
  );
}
