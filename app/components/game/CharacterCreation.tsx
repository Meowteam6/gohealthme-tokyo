"use client";

// Character creation: sign in, prove you are one human, pick your name, pair
// your wearable. Replaces the closed-beta wall. The steps are a real sequence,
// so they are numbered; the current one is open and the rest collapse to one
// line each with their result. The page header is every page's header
// (PerchedHeader): the title and lead outside the card, SPOTTER beside the
// lead in a new pose per step, standing on the steps card, the one pose on the
// screen (docs/DESIGN.md).
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
import SpotterCaption from "@/components/spotter/SpotterCaption";
import { Button, Card } from "@/components/ui";
import { Notice, PAGE_COLUMN, PerchedHeader, QUIET_ACTION } from "@/components/night/kit";
import { poseFor, poseMeta, type SpotterScreenState, type StageWidth } from "@/lib/spotter-poses";
import CharacterCard from "@/components/game/CharacterCard";
import SignInStep from "@/components/game/SignInStep";
import SlowSignInNotice from "@/components/night/SlowSignInNotice";
import SensorStep from "@/components/game/SensorStep";
import {
  STEP_ORDER,
  currentStep,
  type StepId,
  type StepState,
} from "@/lib/game/character";
import type { CharacterView } from "@/lib/game/useCharacter";
import type { Onboarding } from "@/lib/game/onboarding-store";
import { useSwitches } from "@/lib/game/useSwitches";
import { worldPausedLine } from "@/lib/switches";
import { useApprovalMode } from "@/components/game/ApprovalNote";

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

const DONE_LINE = "That is your player. Every challenge reads this card.";

/** SPOTTER's height beside the lead, [phone, from 900px]. Each pose gets the
 *  width that gives it this height, so the steps card never moves when the
 *  pose changes with the step. */
const FIGURE_HEIGHT: StageWidth = [124, 188];

function sceneOf(step: StepId | null): { state: SpotterScreenState; line: string } {
  return step !== null
    ? { state: SCENE[step], line: SPOTTER_LINE[step] }
    : { state: "onboarding-welcome", line: DONE_LINE };
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
  const switches = useSwitches();
  // Where the payout confirmation is on, a World-verified player confirms
  // each payout with World ID, and a list player or an admin is paid on the
  // verdict with no extra step (Andre, 2026-10-02, "Pay on the verdict";
  // lib/game/join-checks payoutPathOf). Said here, so neither the list nor
  // adding World ID later changes how a hit pays without the player seeing it.
  const approvalMode = useApprovalMode();
  const confirmsWithWorld =
    (approvalMode === "world" || approvalMode === "mock") && view.worldLane === "on";
  const address = view.address;
  if (address === null) return null;
  const state = view.steps.human;
  const proof = view.character?.humanProof ?? null;

  if (view.humanMode === "world" && !useList) {
    if (state.status === "done" && proof !== "admin" && proof !== "list") {
      return (
        <Notice tone="ok" title={state.summary}>
          It covers every challenge you enter.
        </Notice>
      );
    }
    if (state.status === "done") {
      // In through the list (or an admin): every challenge is open to them,
      // and where World players confirm payouts, SPOTTER pays them on the
      // verdict instead. World ID stays on offer as optional, because a name
      // on the board comes with it (one per human); where the confirmation is
      // on, it also moves their payouts to a World ID confirm, so that is said
      // before they scan.
      return (
        <div className="[&>*+*]:mt-3">
          <Notice tone="ok" title={state.summary}>
            {confirmsWithWorld
              ? "It covers every challenge you enter, and SPOTTER pays you on the verdict: no World ID step when you hit."
              : "It covers every challenge you enter."}
          </Notice>
          <p className="m-0 text-[0.9375rem] leading-[1.5] text-muted">
            {confirmsWithWorld
              ? "Optional: verify with World ID once to pick a name for the board. After that, you confirm each payout with World ID before it moves."
              : "Optional: verify with World ID once to pick a name for the board. Nothing changes about the challenges you can join."}
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
          {onSkip !== undefined ? <SkipLink onSkip={onSkip} label="Not now" /> : null}
        </div>
      );
    }
    return (
      <div className="[&>*+*]:mt-3">
        {state.status === "waiting" ? (
          <Notice
            tone="limit"
            title="Your list request is in"
            live
            action={
              <Button type="button" variant="secondary" size="sm" onClick={() => view.access.refetch()}>
                Check my spot
              </Button>
            }
          >
            You get in as soon as it is approved. World ID gets you in right now
            instead, if you have it.
          </Notice>
        ) : null}
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
        {!view.gate && state.status !== "waiting" ? (
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
          {switches.worldPaused
            ? worldPausedLine(switches.reason)
            : "World ID is not switched on for this build, so the list is the way in."}
        </p>
      ) : confirmsWithWorld ? (
        <p className="m-0 text-[0.9375rem] text-muted">
          On the list, SPOTTER pays you on the verdict: when your wearable shows
          the goal met, there is no World ID step before your payout.
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

function SignInBody({ ready }: { ready: boolean }) {
  return (
    <>
      <SlowSignInNotice waiting={!ready} className="mb-4" />
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
  above,
}: {
  view: CharacterView;
  onboarding: Onboarding;
  /** A step the caller asked for (the lobby's fix links pass ?step=). */
  focus?: StepId | null;
  /** "gate": shown in place of a page until the hard steps pass and the
   *  onboarding pass is done. "page": the /character editor. */
  mode: "gate" | "page";
  /** Over the title: the way back to the run a lock fix came from. */
  above?: ReactNode;
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
  const scene = sceneOf(open);
  const pose = poseFor(scene.state).pose;
  const meta = poseMeta(pose);
  const figure: StageWidth = [
    Math.round((FIGURE_HEIGHT[0] * meta.width) / meta.height),
    Math.round((FIGURE_HEIGHT[1] * meta.width) / meta.height),
  ];

  return (
    <div className={`${PAGE_COLUMN} py-2 min-[960px]:py-4`}>
      <PerchedHeader
        title={mode === "page" ? "Your player" : "Make your player"}
        lead="Four steps, once. Every challenge reads this card after that."
        above={above}
        // No money moves on this page; the footer carries the beta line.
        below={<SpotterCaption line={scene.line} live className="mt-4 max-w-md" />}
        pose={pose}
        width={figure}
      >
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
      </PerchedHeader>
    </div>
  );
}
