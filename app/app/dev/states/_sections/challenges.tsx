"use client";

import Link from "next/link";
import { GallerySection, StateFrame, type SectionProps } from "../_kit";
import SignInPanel from "@/components/SignInPanel";
import { EmptyCard } from "@/components/night/kit";
import {
  Frame,
  InChallengeCard,
  InvitedChallengeCard,
  PAUSED_TITLE,
  PRIMARY_LINK,
  SectionHead,
  SentChallengeCard,
  StartAction,
  StartCard,
} from "@/components/challenges/ChallengeCards";
import { Card, ErrorNote, Skeleton } from "@/components/ui";
import type { PoolInfo } from "@/lib/contract";

// Challenges states for the dev gallery: /challenges signed out, loading,
// empty, paused, with challenges on both sides, and a failed read. The cards
// are the real components with fixture pools; the page owns every chain read.

const USDC = 1_000_000n;
const NOW = BigInt(Math.floor(Date.UTC(2026, 8, 26, 12, 0, 0) / 1000));
const DAY = 86_400n;

function pool(overrides: Partial<PoolInfo>): PoolInfo {
  return {
    id: 41n,
    creator: "0x8a39000000000000000000000000000000006141",
    bountyModel: 2,
    settled: false,
    cancelled: false,
    periodStart: NOW - DAY,
    periodEnd: NOW + 2n * DAY,
    entryFee: 1n * USDC,
    balance: 6n * USDC,
    initiative: "challenge",
    goalSpec: "Sleep at least 7 hours for 3 nights",
    ...overrides,
  };
}

const PAUSE = {
  detail:
    "A verified win could not be paid out on this build right now, so no new challenge can start. Your open ones are untouched.",
};

function LoadingCard() {
  return (
    <Card aria-busy="true">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-5 h-11 w-44" />
    </Card>
  );
}

export default function ChallengeStates({ meta }: SectionProps) {
  const invited = {
    pool: pool({ id: 44n, goalSpec: "Complete at least 1 workout for 5 days", balance: 11n * USDC }),
    participantCount: 1,
    inviteToken: "fixture-token",
    challengerAddress: "0x8a39000000000000000000000000000000006141",
    message: "You said you'd start Monday. It's Monday.",
  };
  const inEntry = {
    pool: pool({ id: 42n }),
    participant: { joined: true, resultRecorded: false, verdict: false, refunded: false, multiplierBps: 10_000 },
    participantCount: 1,
    tier: null,
  };
  const paidEntry = {
    pool: pool({ id: 39n, settled: true, goalSpec: "Sleep efficiency 85% or better for 3 nights" }),
    participant: { joined: true, resultRecorded: true, verdict: true, refunded: false, multiplierBps: 10_000 },
    participantCount: 1,
    tier: "verified" as const,
  };
  const sentReward = {
    pool: pool({ id: 43n, creator: "0x1111000000000000000000000000000000000001", balance: 5n * USDC }),
    participantCount: 0,
    selfStaked: false,
  };
  const sentSelf = {
    pool: pool({ id: 45n, balance: 1n * USDC, goalSpec: "Sleep at least 7 hours for 1 night" }),
    participantCount: 1,
    selfStaked: true,
  };

  return (
    <GallerySection meta={meta}>
      <StateFrame name="challenges-signed-out" note="signed out: sign in on the card SPOTTER stands on">
        <Frame
          pose="wave"
          lead="Sign in to see the challenges aimed at you and the ones you sent. Base Sepolia test USDC."
          first={<SignInPanel surface="card" />}
        />
      </StateFrame>

      <StateFrame name="challenges-loading" note="reading the chain">
        <Frame pose="detective" first={<LoadingCard />} />
      </StateFrame>

      <StateFrame name="challenges-empty" note="signed in, nothing sent, joined or invited">
        <Frame
          pose="meditate"
          first={
            <EmptyCard
              title="No challenges yet"
              detail="Stake on your own goal, or put up a reward and challenge a friend. Your wearable decides. When someone challenges you, it shows up here too."
              action={<StartAction paused={false} />}
            />
          }
        />
      </StateFrame>

      <StateFrame name="challenges-paused-empty" note="a verified win could not pay on this build, nothing to show">
        <Frame
          pose="thinking"
          first={<EmptyCard title={PAUSED_TITLE} detail={PAUSE.detail} action={<StartAction paused />} />}
        />
      </StateFrame>

      <StateFrame name="challenges-list" note="invited, in, and started, with the start card on top">
        <Frame pose="wave" first={<StartCard pause={null} />}>
          <section className="space-y-4">
            <SectionHead
              title="Invited to you"
              lead="Challenges aimed at your name. Accept one and stake the small lock-in. Hit the goal and your lock-in comes back plus the reward when the run settles."
            />
            <InvitedChallengeCard entry={invited} challengerName="mika.gohealthme.eth" acceptUrl="#challenge-accept" />
          </section>
          <section className="space-y-4">
            <SectionHead
              title="Challenges you're in"
              lead="Challenges a friend aimed at you that you accepted with a lock-in stake. Your wearable decides; hit it and your stake comes back plus the reward."
            />
            <InChallengeCard entry={inEntry} challengerName="mika.gohealthme.eth" />
            <InChallengeCard entry={paidEntry} challengerName="0x8a39...6141" />
          </section>
          <section className="space-y-4">
            <SectionHead
              title="Challenges you started"
              lead="Commitments you staked on your own goal, and rewards you put up for a friend. You never keep another player's stake."
            />
            <SentChallengeCard entry={sentReward} />
            <SentChallengeCard entry={sentSelf} />
          </section>
        </Frame>
      </StateFrame>

      <StateFrame name="challenges-paused" note="challenges on the page, new ones paused">
        <Frame pose="thinking" first={<StartCard pause={PAUSE} />} />
      </StateFrame>

      <StateFrame name="challenges-error" note="the chain read failed">
        <Frame
          pose="thinking"
          first={
            <Card>
              <ErrorNote
                title="Could not load your challenges"
                detail="I could not read your challenges from Base Sepolia. Nothing changed. Try again."
                retryLabel="Read my challenges again"
                onRetry={() => {}}
              />
            </Card>
          }
        />
      </StateFrame>

      <StateFrame name="challenges-signin-off" note="a build with sign-in off">
        <Frame
          pose="meditate"
          first={
            <EmptyCard
              title="Sign-in is off on this build"
              detail="Challenges need a signed-in wallet, and this build has sign-in off. Nothing is wrong on your side. The open runs are still there to look at."
              action={
                <Link href="/pools" className={PRIMARY_LINK}>
                  See the open runs
                </Link>
              }
            />
          }
        />
      </StateFrame>
    </GallerySection>
  );
}
