"use client";

import { useState } from "react";
import LockPanel from "@/components/game/LockPanel";
import RunSlip from "@/components/game/RunSlip";
import FeaturedRunCard from "@/components/landing/FeaturedRunCard";
import HeroStage from "@/components/landing/HeroStage";
import HowItPays from "@/components/landing/HowItPays";
import { LandingView, type LandingData, type LandingFlags } from "@/components/landing/Landing";
import OpenRunsList from "@/components/landing/OpenRunsList";
import { Button } from "@/components/ui";
import type { PoolInfo } from "@/lib/contract";
import { pickFeaturedRun, termsOf, type OpenRun, type OutcomeKey } from "@/lib/game/landing";
import type { LobbyRow, RunSlot } from "@/lib/game/lobby";
import { brandFit, type WearableBrand } from "@/lib/game/wearable-fit";
import { GallerySection, StateFrame, type SectionProps } from "../_kit";

// The landing, the lobby's cards and locks, and the header, with fixture
// props (docs/DESIGN.md). Every money figure is worked by lib/commitment.ts
// from the fixture pools below, never typed; nothing reads a wallet or the
// chain. The lobby's card and lock states live here too, because the lobby's
// Night pass shipped with the landing (the "lobby" section is My runs and
// History).

const USDC = 1_000_000n;
const NOW = BigInt(Math.floor(Date.now() / 1000));
const HOUR = 3600n;

function pool(over: Partial<PoolInfo> & { id: bigint }): PoolInfo {
  return {
    creator: "0x0000000000000000000000000000000000000001",
    bountyModel: 2,
    settled: false,
    cancelled: false,
    periodStart: NOW - HOUR,
    periodEnd: NOW + 16n * HOUR,
    entryFee: USDC,
    balance: 2n * USDC,
    initiative: "Sleep 7 hours Saturday night",
    goalSpec: "Sleep at least 7 hours for 1 night",
    ...over,
  };
}

const SLEEP = pool({ id: 5n });
const EFFICIENCY = pool({
  id: 4n,
  initiative: "Sleep efficiency 85 tonight",
  goalSpec: "Sleep efficiency 85% or better for 1 night",
  periodEnd: NOW + 18n * HOUR,
});
const WORKOUT = pool({
  id: 2n,
  initiative: "One workout today",
  goalSpec: "Complete at least 1 workout for 1 day",
  periodEnd: NOW + 15n * HOUR,
  balance: 3n * USDC,
});
const STEPS = pool({
  id: 7n,
  initiative: "10,000 steps Sunday",
  goalSpec: "Walk at least 10000 steps for 1 day",
  periodEnd: NOW + 30n * HOUR,
  balance: USDC,
});

/** Nobody in anywhere: the sleep run leads (the approved mock). */
const QUIET: OpenRun[] = [
  { pool: WORKOUT, players: 0 },
  { pool: SLEEP, players: 0 },
  { pool: EFFICIENCY, players: 0 },
];
/** One player in the workout run: it has the most players, so it leads. */
const BUSY: OpenRun[] = [
  { pool: WORKOUT, players: 1 },
  { pool: SLEEP, players: 0 },
  { pool: EFFICIENCY, players: 0 },
];

const FLAGS: LandingFlags = {
  human: true,
  confirm: true,
  missRule: true,
  availability: { junction: true, whoop: true, apple: false },
};

function ready(runs: OpenRun[], feeBps: number | null = 0): LandingData {
  return { status: "ready", runs, featured: pickFeaturedRun(runs), feeBps, retry: () => {} };
}

function Stage({
  data,
  joined = false,
  woke = false,
  wear = null,
}: {
  data: LandingData;
  joined?: boolean;
  woke?: boolean;
  /** The visitor's picked wearable, for the card's fit line. */
  wear?: WearableBrand | null;
}) {
  const fit =
    wear !== null && data.featured !== null
      ? brandFit(wear, data.featured.pool.goalSpec, FLAGS.availability)
      : null;
  return (
    <HeroStage woke={woke}>
      <FeaturedRunCard
        status={data.status}
        run={data.featured}
        feeBps={data.feeBps}
        joined={joined}
        fit={fit}
        onRetry={data.retry}
      />
    </HeroStage>
  );
}

function Picker({ initial, runs = QUIET, availability = FLAGS.availability }: {
  initial: WearableBrand | null;
  runs?: OpenRun[];
  availability?: LandingFlags["availability"];
}) {
  const [picked, setPicked] = useState<WearableBrand | null>(initial);
  return (
    <OpenRunsList status="ready" runs={runs} availability={availability} picked={picked} onPick={setPicked} />
  );
}

function row(p: PoolInfo, slot: RunSlot, highlighted = false): LobbyRow {
  return { pool: p, phase: slot.kind === "closed" ? "settled" : "live", slot, highlighted };
}

const noCheck = async (): Promise<boolean> => {
  await new Promise((r) => setTimeout(r, 900));
  return false;
};

function Landing() {
  const [picked, setPicked] = useState<WearableBrand | null>(null);
  return <LandingView flags={FLAGS} data={ready(QUIET)} picked={picked} onPick={setPicked} />;
}

/** How it pays for the featured run. `recordsMisses` picks the miss-rule
 *  cutoff: 1 puts every fixture pool past it, null switches the rule off. */
function Outcome({ k, recordsMisses = true }: { k: OutcomeKey; recordsMisses?: boolean }) {
  const featured = pickFeaturedRun(QUIET);
  return (
    <HowItPays
      terms={featured !== null ? termsOf(featured, 0, recordsMisses ? 1n : null) : null}
      confirm
      missRule={recordsMisses}
      initial={k}
    />
  );
}

export default function LandingStates({ meta }: SectionProps) {
  return (
    <GallerySection meta={meta}>
      <StateFrame name="landing-default" note="signed out, nobody in anywhere, so the sleep run leads; the whole page">
        <Landing />
      </StateFrame>

      <StateFrame name="landing-featured-players" note="one player in the workout run: most players leads, the range reads 2.00 to 4.00" phone>
        <Stage data={ready(BUSY)} />
      </StateFrame>
      <StateFrame name="landing-featured-fit" note="WHOOP picked below: the hero card says it can check this run" phone>
        <Stage data={ready(QUIET)} wear="whoop" />
      </StateFrame>
      <StateFrame name="landing-featured-locked" note="Apple Watch picked: the card says so before any tap, and the action only opens the run" phone>
        <Stage data={ready(QUIET)} wear="apple" />
      </StateFrame>
      <StateFrame name="landing-joined" note="signed in and already in the featured run: the action goes back to it" phone>
        <Stage data={ready(QUIET)} joined />
      </StateFrame>
      <StateFrame name="landing-woke" note="after one tap on SPOTTER: he waves and says his one line" phone>
        <Stage data={ready(QUIET)} woke />
      </StateFrame>
      <StateFrame name="landing-loading" note="pools, counts or the fee still reading: the card holds its shape" phone>
        <Stage data={{ status: "loading", runs: [], featured: null, feeBps: null }} />
      </StateFrame>
      <StateFrame name="landing-error" note="the chain read failed: nothing staked, read again" phone>
        <Stage data={{ status: "error", runs: [], featured: null, feeBps: null, retry: () => {} }} />
      </StateFrame>
      <StateFrame name="landing-no-open-runs" note="nothing live: start a challenge" phone>
        <Stage data={ready([])} />
      </StateFrame>
      <StateFrame name="landing-fee-unread" note="the fee did not read: no figure past the stake" phone>
        <Stage data={ready(QUIET, null)} />
      </StateFrame>

      <StateFrame name="landing-outcome-hit" note="How it pays, You hit, worked from the featured run">
        <Outcome k="hit" />
      </StateFrame>
      <StateFrame name="landing-outcome-miss" note="You miss: the stake goes to the players who hit; no data is not a miss">
        <Outcome k="miss" />
      </StateFrame>
      <StateFrame name="landing-outcome-none" note="Nobody hits: every stake back">
        <Outcome k="none" />
      </StateFrame>
      <StateFrame name="landing-outcome-miss-refund" note="You miss, on a run that cannot record a miss (lib/miss-rule.ts): the stake comes back">
        <Outcome k="miss" recordsMisses={false} />
      </StateFrame>

      <StateFrame name="landing-wearable-whoop" note="WHOOP picked: every open run checks, the step limit is named" phone>
        <Picker initial="whoop" runs={[...QUIET, { pool: STEPS, players: 0 }]} />
      </StateFrame>
      <StateFrame name="landing-wearable-apple" note="Apple Watch picked: locked before any stake, with what works today" phone>
        <Picker initial="apple" />
      </StateFrame>
      <StateFrame name="landing-wearable-none" note="None yet: look around, a wearable is needed to stake" phone>
        <Picker initial="none" />
      </StateFrame>
      <StateFrame name="landing-wearable-oura-unpaired" note="a build without Junction: Oura cannot pair, so every run says so" phone>
        <Picker initial="oura" availability={{ junction: false, whoop: true, apple: false }} />
      </StateFrame>

      <StateFrame name="lobby-cards" note="the lobby's run cards by slot, signed in">
        <ul className="m-0 grid list-none gap-2.5 p-0 min-[900px]:grid-cols-3 min-[900px]:gap-4">
          <li>
            <RunSlip row={row(SLEEP, { kind: "playable" })} returnTo="/pools" players={0} />
          </li>
          <li>
            <RunSlip row={row(WORKOUT, { kind: "in-run" })} returnTo="/pools" players={1} />
          </li>
          <li>
            <RunSlip row={row(EFFICIENCY, { kind: "checking" })} returnTo="/pools" players={0} />
          </li>
          <li>
            <RunSlip
              row={row(STEPS, { kind: "locked", lock: { kind: "cannot-measure", metric: "steps", deviceLabel: "WHOOP" } })}
              returnTo="/pools"
              players={0}
            />
          </li>
          <li>
            <RunSlip row={row(SLEEP, { kind: "locked", lock: { kind: "sensor-unchecked" } })} returnTo="/pools" players={0} />
          </li>
          <li>
            <RunSlip row={row(EFFICIENCY, { kind: "locked", lock: { kind: "not-human" } })} returnTo="/pools" players={0} />
          </li>
          <li>
            <RunSlip row={row(WORKOUT, { kind: "locked", lock: { kind: "outage" } })} returnTo="/pools" players={1} />
          </li>
          <li>
            <RunSlip
              row={row(SLEEP, { kind: "locked", lock: { kind: "check-failed", check: "human" } })}
              returnTo="/pools"
              players={0}
              onRetry={() => {}}
            />
          </li>
          <li>
            <RunSlip row={row(WORKOUT, { kind: "closed", joined: true })} returnTo="/pools" />
          </li>
        </ul>
      </StateFrame>
      <StateFrame name="lobby-signed-out-picked" note="signed out with WHOOP picked: the step run reads locked" phone>
        <div className="grid gap-2.5">
          <RunSlip
            row={row(SLEEP, { kind: "locked", lock: { kind: "sign-in" } })}
            returnTo="/pools"
            players={0}
            visitorFit={brandFit("whoop", SLEEP.goalSpec, FLAGS.availability)}
          />
          <RunSlip
            row={row(STEPS, { kind: "locked", lock: { kind: "sign-in" } })}
            returnTo="/pools"
            players={0}
            visitorFit={brandFit("whoop", STEPS.goalSpec, FLAGS.availability)}
          />
        </div>
      </StateFrame>
      <StateFrame name="lobby-challenge-highlight" note="the challenge link's run: marked, with its entry control on the card" phone>
        <RunSlip
          row={row(pool({ id: 9n, initiative: "challenge" }), { kind: "playable" }, true)}
          returnTo="/c/token"
          players={1}
          action={<Button block>Accept and put 1 USDC on myself</Button>}
        />
      </StateFrame>
      <StateFrame name="lobby-lock-sensor-check" note="the one tap at the top of the lobby; this fixture declines the signature" phone>
        <LockPanel lock={{ kind: "sensor-unchecked" }} returnTo="/pools" onCheckSensor={noCheck} />
      </StateFrame>
      <StateFrame name="lobby-lock-hardware" note="the run page's lock: a hardware limit with the fix as the one action" phone>
        <LockPanel lock={{ kind: "cannot-measure", metric: "steps", deviceLabel: "WHOOP" }} returnTo="/pools/7" />
      </StateFrame>
      <StateFrame name="lobby-lock-paused" note="a build-wide pause: no fix, it clears on its own" phone>
        <LockPanel lock={{ kind: "payouts-paused" }} returnTo="/pools" />
      </StateFrame>

    </GallerySection>
  );
}
