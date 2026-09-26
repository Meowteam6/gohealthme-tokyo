"use client";

// The landing (docs/DESIGN.md, Night Shift): the headline and a real open run
// in the first screen, how a run pays with this run's own figures, every open
// run marked for the visitor's wearable, and the challenge band. The chain
// reads are useOpenRuns; LandingView is the same page from props, so the state
// gallery renders every state without a wallet or a chain.

import HeroActivityTicker from "@/components/HeroActivityTicker";
import FeaturedRunCard from "@/components/landing/FeaturedRunCard";
import HeroStage from "@/components/landing/HeroStage";
import HowItPays from "@/components/landing/HowItPays";
import OpenRunsList from "@/components/landing/OpenRunsList";
import { ButtonLink, ChevronLink } from "@/components/ui";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { termsOf, type OpenRun, type OutcomeKey } from "@/lib/game/landing";
import { useMyRuns } from "@/lib/game/useLobby";
import { useOpenRuns, type OpenRunsStatus } from "@/lib/game/useOpenRuns";
import { useWearPick } from "@/lib/game/useWearPick";
import type { WearableAvailability, WearableBrand } from "@/lib/game/wearable-fit";
import { useEmbeddedWallet } from "@/lib/wallet";

/** What this deployment does, read on the server (app/page.tsx). */
export interface LandingFlags {
  /** World proof-of-human is on: one human, one entry. */
  human: boolean;
  /** SPOTTER asks the player to confirm with World ID before it pays. */
  confirm: boolean;
  /** Which wearable providers this build can pair. */
  availability: WearableAvailability;
}

export interface LandingData {
  status: OpenRunsStatus;
  runs: readonly OpenRun[];
  featured: OpenRun | null;
  feeBps: number | null;
  retry?: () => void;
}

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="flex-none text-muted">
      <path d="M8 1.5 13.5 4v4c0 3.2-2.3 5.6-5.5 6.5C4.8 13.6 2.5 11.2 2.5 8V4L8 1.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="flex-none text-muted">
      <circle cx="8" cy="5.5" r="2.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.8 14c.6-2.6 2.7-4.2 5.2-4.2s4.6 1.6 5.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function HeroMore({ status, count, human, className }: { status: OpenRunsStatus; count: number; human: boolean; className: string }) {
  const label =
    status !== "ready" || count === 0
      ? "See the open runs"
      : count === 1
        ? "See the open run"
        : `See all ${count} open runs`;
  return (
    <div className={`flex-col items-start ${className}`}>
      <ChevronLink href="#runs" className="num">
        {label}
      </ChevronLink>
      <ul className="m-0 flex list-none flex-wrap gap-x-[18px] gap-y-1 p-0 text-[0.8125rem] leading-[1.3] text-haze min-[900px]:gap-x-[22px] min-[900px]:text-sm">
        <li className="inline-flex min-h-6 items-center gap-1.5">
          <ShieldIcon />
          Health data stays private
        </li>
        <li className="inline-flex min-h-6 items-center gap-1.5">
          <PersonIcon />
          {human ? "One person, one entry" : "Invite-only beta"}
        </li>
      </ul>
    </div>
  );
}

export function LandingView({
  flags,
  data,
  joined = false,
  picked,
  onPick,
  woke = false,
  outcome = "hit",
}: {
  flags: LandingFlags;
  data: LandingData;
  joined?: boolean;
  picked: WearableBrand | null;
  onPick: (brand: WearableBrand) => void;
  woke?: boolean;
  outcome?: OutcomeKey;
}) {
  const count = data.runs.length;
  const terms = data.status === "ready" && data.featured !== null ? termsOf(data.featured, data.feeBps) : null;

  return (
    <div className="max-[639px]:-mb-14">
      <section
        aria-labelledby="poster-title"
        className="relative isolate pb-7 max-[899px]:-mx-[var(--gutter)] max-[899px]:overflow-x-clip max-[899px]:px-[var(--gutter)] min-[900px]:grid min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,500px)] min-[900px]:items-center min-[900px]:gap-x-14 min-[900px]:pb-[72px] min-[900px]:pt-2"
      >
        <div>
          <h1 id="poster-title" className="type-display m-0 text-[2.75rem] min-[900px]:text-[5rem] min-[900px]:leading-[0.98]">
            Put money on yourself.
          </h1>
          <p className="m-0 mt-3 text-[1.0625rem] leading-[1.45] text-muted min-[900px]:mt-[22px] min-[900px]:text-[1.3125rem]">
            <span className="block">Stake on your sleep or workouts.</span>
            <span className="block">Your wearable decides.</span>
          </p>
          <HeroMore status={data.status} count={count} human={flags.human} className="hidden gap-2 min-[900px]:mt-[26px] min-[900px]:flex" />
        </div>

        <HeroStage woke={woke}>
          <FeaturedRunCard
            status={data.status}
            run={data.featured}
            feeBps={data.feeBps}
            joined={joined}
            onRetry={data.retry}
          />
        </HeroStage>

        <HeroMore status={data.status} count={count} human={flags.human} className="mt-2.5 flex gap-0.5 min-[900px]:hidden" />
      </section>

      <section id="how" aria-labelledby="how-h" className="scroll-mt-20 pb-10 pt-6 min-[900px]:pb-[88px]">
        <h2 id="how-h" className="type-title m-0 text-[2rem] min-[900px]:text-[3rem]">
          Everyone stakes the same. Your night decides the rest.
        </h2>
        <p className="m-0 mt-2.5 max-w-[44ch] text-[1.0625rem] text-muted text-pretty">
          Your result depends only on what your own wearable records.
        </p>
        <HowItPays terms={terms} confirm={flags.confirm} initial={outcome} />
      </section>

      <section id="runs" aria-labelledby="runs-h" className="scroll-mt-20 pb-10 min-[900px]:pb-[88px]">
        <h2 id="runs-h" className="type-title m-0 text-[2rem] min-[900px]:text-[3rem]">
          Open runs
        </h2>
        <OpenRunsList
          status={data.status}
          runs={data.runs}
          availability={flags.availability}
          picked={picked}
          onPick={onPick}
          onRetry={data.retry}
        />
        <HeroActivityTicker />
      </section>

      <section id="friends" aria-labelledby="friend-h" className="min-[900px]:pb-10">
        <div className="flex flex-col items-start gap-4 rounded-card bg-[linear-gradient(180deg,var(--surface-top)_0%,var(--surface)_120px)] px-[18px] py-5 shadow-card min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between min-[900px]:gap-10 min-[900px]:px-9 min-[900px]:py-8">
          <div>
            <h2 id="friend-h" className="type-heading m-0 text-[1.5625rem] min-[900px]:text-[2rem]">
              Know someone who swears they sleep 8 hours?
            </h2>
            <p className="m-0 mt-2 max-w-[52ch] text-muted">
              Send them a challenge link. They see the goal, the stake and the
              pot before they sign up, and the same rules hold: hit it and your
              stake comes back.
            </p>
          </div>
          <ButtonLink href="/challenge/new" variant="secondary" className="flex-none">
            Challenge a friend
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}

export default function Landing({ flags }: { flags: LandingFlags }) {
  const data = useOpenRuns();
  const [picked, setPick] = useWearPick();
  const { ready, authenticated, address } = useEmbeddedWallet();
  const signedIn = DYNAMIC_CONFIGURED && ready && authenticated;
  const myRuns = useMyRuns(signedIn ? address : null);
  const featuredId = data.featured?.pool.id;
  const joined =
    featuredId !== undefined && (myRuns.data ?? []).some((r) => r.pool.id === featuredId);

  return (
    <LandingView
      flags={flags}
      data={data}
      joined={joined}
      picked={picked}
      onPick={setPick}
    />
  );
}
