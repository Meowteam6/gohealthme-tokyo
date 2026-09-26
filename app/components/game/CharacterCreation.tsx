"use client";

// Character creation: sign in, prove you are one human, pick your name, pair
// your wearable. Replaces the closed-beta wall. The steps are a real sequence,
// so they are numbered; the current one is open and the rest collapse to one
// line each with their result. SPOTTER stands on the title card's top edge in
// a new pose per step, the one pose on the screen (docs/DESIGN.md).
//
// The World, ENS and sensor steps mount the other lanes' components through
// their contracts (docs/LANES.md) and never assume the lane is on: a lane that
// is not on this build is said plainly and walked past, and with World off the
// allowlist request is the way in, exactly as before V4.

import { useEffect, useState, type ReactNode } from "react";
import ProveHuman from "@/components/world/ProveHuman";
import EnsNameClaim from "@/components/ens/EnsNameClaim";
import ClaimHandle from "@/components/ClaimHandle";
import RequestAccess from "@/components/RequestAccess";
import Perch from "@/components/spotter/Perch";
import SpotterCaption from "@/components/spotter/SpotterCaption";
import { Button, Card } from "@/components/ui";
import { Notice, PAGE_TITLE, QUIET_ACTION } from "@/components/night/kit";
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
  human: "One human, one entry. No bots, no twins.",
  name: "Your friends should see a name on the board, not 0x-something.",
  sensor: "I read your wearable, so show me what it can see. The contract pays on what it says.",
};

const SCENE: Record<StepId, SpotterScreenState> = {
  "sign-in": "onboarding-welcome",
  human: "onboarding-world-id",
  name: "onboarding-name",
  sensor: "onboarding-wearable",
};

const DONE_LINE = "That is your player. Every run reads this card.";

/**
 * The title card over the steps, SPOTTER standing on its top edge in a new
 * pose per step. 84px on a phone so the open step's action stays near the
 * fold at 390x844; 156px from 900px up. The perch reserves the tallest pose's
 * height, so the steps never jump when the pose changes. His line sits in his
 * caption box.
 */
function Scene({ step, title }: { step: StepId | null; title: string }) {
  const state: SpotterScreenState =
    step !== null ? SCENE[step] : "onboarding-welcome";
  const line = step !== null ? SPOTTER_LINE[step] : DONE_LINE;
  return (
    <section className="relative lg:sticky lg:top-24">
      <Perch
        state={state}
        width={[84, 156]}
        reserve={[126, 239]}
        side="right"
        inset={[16, 32]}
        priority
        decorative
      >
        <Card>
          <h1 className={PAGE_TITLE}>{title}</h1>
          <p className="m-0 mt-2 max-w-md text-base text-muted text-pretty">
            Four steps, once. Every run reads this card after that.
          </p>
          <SpotterCaption line={line} live className="mt-4" />
          <p className="m-0 mt-3 text-[0.8125rem] text-haze">Beta on Base Sepolia test USDC.</p>
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
    return <span className="truncate font-medium text-moonlight">{state.summary}</span>;
  }
  if (skipped) return <span className="text-haze">Skipped</span>;
  switch (state.status) {
    case "loading":
      return <span className="text-haze">Checking</span>;
    case "waiting":
      return <span className="text-warning">Waiting</span>;
    case "off":
      return <span className="text-haze">Not on this build</span>;
    case "error":
      return <span className="text-warning">Not answering</span>;
    case "check":
      return <span className="text-haze">Not checked this visit</span>;
    case "todo":
      return <span className="text-haze">To do</span>;
    case "locked":
      return <span className="text-haze">Locked until step 2 is done</span>;
  }
}

function SkipLink({ onSkip, label = "Skip for now" }: { onSkip: () => void; label?: string }) {
  return (
    <button type="button" onClick={onSkip} className={QUIET_ACTION}>
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
      return (
        <Notice tone="ok" title={state.summary}>
          It covers every run you enter.
        </Notice>
      );
    }
    return (
      <div className="[&>*+*]:mt-3">
        <p className="m-0 text-[0.9375rem] leading-[1.5] text-muted">
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
          <Notice tone="error" live>
            {failure} Nothing was recorded. You can try the scan again.
          </Notice>
        ) : null}
        {!view.gate ? (
          <button type="button" onClick={() => setUseList(true)} className={`${QUIET_ACTION} flex`}>
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
      <div className="[&>*+*]:mt-3">
        <Notice tone="limit" title="Your request is in" live>
          You get in as soon as it is approved, and this page opens on its own
          when it is.
        </Notice>
        <Button type="button" variant="secondary" onClick={() => view.access.refetch()}>
          Check my spot
        </Button>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="[&>*+*]:mt-3">
        <Notice tone="limit">{state.note} Your spot is safe.</Notice>
        <Button type="button" variant="secondary" onClick={() => view.access.refetch()}>
          Check again
        </Button>
      </div>
    );
  }
  return (
    <div className="[&>*+*]:mt-2">
      {view.worldLane !== "on" ? (
        <p className="m-0 text-[0.9375rem] text-muted">
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
      <div className="[&>*+*]:mt-3">
        <Notice tone="limit">{state.note}</Notice>
        <Button type="button" variant="secondary" size="sm" onClick={onProveHuman}>
          Go to step 2
        </Button>
        <p className="m-0 text-[0.8125rem] text-haze">
          Optional. Without one you play under your short wallet address.
        </p>
        {onSkip !== undefined ? <SkipLink onSkip={onSkip} /> : null}
      </div>
    );
  }
  return (
    <div className="[&>*+*]:mt-3">
      {view.nameMode === "ens" ? (
        <EnsNameClaim
          address={address}
          currentName={state.status === "done" ? state.summary : null}
          onClaimed={() => view.refresh()}
        />
      ) : (
        <>
          <p className="m-0 text-[0.9375rem] text-muted">
            ENS names are not switched on for this build, so your name is a
            GoHealthMe handle.
          </p>
          <ClaimHandle />
        </>
      )}
      <p className="m-0 text-[0.8125rem] text-haze">
        Optional. Without one you play under your short wallet address.
      </p>
      {onSkip !== undefined ? (
        <SkipLink onSkip={onSkip} label={state.status === "done" ? "Done" : "Skip for now"} />
      ) : null}
    </div>
  );
}

/** How long the sign-in step waits for the wallet SDK before it says so and
 *  offers a reload, instead of "Checking" forever. */
const SDK_SLOW_MS = 8000;

function useSlow(waiting: boolean, ms: number): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [waiting, ms]);
  return waiting && slow;
}

function SignInBody({ ready }: { ready: boolean }) {
  const slow = useSlow(!ready, SDK_SLOW_MS);
  return (
    <>
      {slow ? (
        <Notice
          tone="limit"
          title="Sign-in is taking longer than usual"
          role="status"
          live
          className="mb-4"
          action={
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
              Reload the page
            </Button>
          }
        >
          The sign-in service has not answered yet. A reload usually fixes it; nothing is lost.
        </Notice>
      ) : null}
      <SignInStep />
    </>
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
      return <SignInBody ready={view.ready} />;
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
    <div className="mx-auto grid w-full max-w-5xl gap-6 py-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:items-start lg:gap-10 min-[960px]:py-4">
      <Scene step={open} title={mode === "page" ? "Your player" : "Make your player"} />

      <div className="min-w-0 [&>*+*]:mt-6">
      <Card as="ol" padding="none" aria-label="Steps" className="m-0 list-none divide-y divide-edge overflow-hidden p-0">
        {STEP_ORDER.map((id, index) => {
          const state = view.steps[id];
          const isOpen = open === id;
          const canPick = signedIn && view.gate && !hardOpen && id !== "sign-in";
          const header = (
            <>
              <span
                aria-hidden="true"
                className={`num flex size-9 shrink-0 items-center justify-center rounded-full text-[0.9375rem] font-semibold ${
                  state.status === "done" && !isOpen
                    ? "bg-moonlight/10 text-moonlight shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--moonlight)_35%,transparent)]"
                    : isOpen
                      ? "bg-accent text-accent-foreground shadow-selected"
                      : "bg-fill-quiet text-haze shadow-[inset_0_0_0_1px_var(--border-strong)]"
                }`}
              >
                {state.status === "done" && !isOpen ? (
                  <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[1.0625rem] font-semibold leading-tight text-foreground">
                  <span className="sr-only">Step {index + 1}: </span>
                  {TITLE[id]}
                </span>
                <span className="mt-0.5 block truncate text-sm">
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
                  className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-[120ms] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground min-[960px]:px-6"
                >
                  {header}
                </button>
              ) : (
                <div className="flex min-h-16 items-center gap-3 px-4 py-3 min-[960px]:px-6">{header}</div>
              )}
              {isOpen ? (
                <div className="px-4 pb-5 sm:pl-16 min-[960px]:pl-[4.5rem] min-[960px]:pr-6">
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
      </Card>

      {signedIn && view.gate && current === null && mode === "gate" ? (
        <div className="[&>*+*]:mt-3">
          <CharacterCard view={view} />
          <Button type="button" block onClick={onboarding.finish}>
            Take me in
          </Button>
        </div>
      ) : null}
      {signedIn && view.gate && mode === "page" ? <CharacterCard view={view} /> : null}
      </div>
    </div>
  );
}
