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
import {
  BackerView,
  ChallengeIntro,
  ChallengeInvalid,
  ChallengePausedCard,
  RallyCard,
} from "@/components/challenges/ChallengeLanding";
import ChallengeInviteShare, { InviteLinks } from "@/components/ChallengeInviteShare";
import ChipInWarning from "@/components/ChipInWarning";
import { PAGE_COLUMN } from "@/components/night/kit";
import { Card, ErrorNote, Skeleton } from "@/components/ui";
import type { PoolInfo } from "@/lib/contract";
import { potLineOf } from "@/lib/game/money-flow";
import { inviteShareOf } from "@/lib/game/money-sharing";

const SELF_SHARE = inviteShareOf("self");
const selfLinks = SELF_SHARE.kind === "links" ? SELF_SHARE.links : [];

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
  // The one challenge flow: 10.00 staked by the creator plus 2.00 extra.
  const sentSelf = {
    pool: pool({ id: 45n, entryFee: 10n * USDC, balance: 12n * USDC, goalSpec: "Sleep at least 7 hours for 1 night" }),
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
              detail="Put money on your own goal and challenge a friend to match it. Your wearable decides. When someone challenges you, it shows up here too."
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
          <section className="[&>*+*]:mt-4">
            <SectionHead
              title="Invited to you"
              lead="Challenges aimed at your name. Match the stake to join. Hit the goal and your stake comes back plus the stake of whoever misses."
            />
            <InvitedChallengeCard entry={invited} challengerName="mika.gohealthme.eth" acceptUrl="#challenge-accept" />
          </section>
          <section className="[&>*+*]:mt-4">
            <SectionHead
              title="Challenges you're in"
              lead="Challenges you staked in. Your wearable decides; hit it and your stake comes back plus your share of the pot."
            />
            <InChallengeCard entry={inEntry} challengerName="mika.gohealthme.eth" />
            <InChallengeCard entry={paidEntry} challengerName="0x8a39...6141" />
          </section>
          <section className="[&>*+*]:mt-4">
            <SectionHead
              title="Challenges you started"
              lead="Challenges you put money on. You never keep another player's stake."
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

      <StateFrame name="challenge-accept-match" note="the Match my stake link: 10.00 each, 2.00 extra in the pot">
        <div className={PAGE_COLUMN}>
          <ChallengeIntro
            kind="self"
            challengerName="mika.gohealthme.eth"
            targetHandle="andre"
            message={null}
            terms={{ entryFee: 10n * USDC, players: 1, sponsorPot: 2n * USDC, recordsMisses: true }}
            backers={["nikki.gohealthme.eth"]}
            stake={10n * USDC}
            potLine={potLineOf({ stake: 10n * USDC, stakers: ["mika.gohealthme.eth"], extra: 2n * USDC })}
          />
        </div>
      </StateFrame>

      <StateFrame name="challenge-accept-match-no-miss" note="Match my stake on a goal that cannot record a miss: a miss comes back">
        <div className={PAGE_COLUMN}>
          <ChallengeIntro
            kind="self"
            challengerName="mika.gohealthme.eth"
            targetHandle={null}
            message={null}
            terms={{ entryFee: 5n * USDC, players: 1, sponsorPot: 0n, recordsMisses: false }}
            backers={[]}
            stake={5n * USDC}
            potLine={potLineOf({ stake: 5n * USDC, stakers: ["mika.gohealthme.eth"], extra: 0n })}
          />
        </div>
      </StateFrame>

      <StateFrame name="challenge-accept-before-lock-in" note="the friend opens the link before the creator locked in, 2.00 extra already in: still match the stake">
        <div className={PAGE_COLUMN}>
          <ChallengeIntro
            kind="unstaked"
            challengerName="mika.gohealthme.eth"
            targetHandle="andre"
            message={null}
            terms={{ entryFee: 10n * USDC, players: 0, sponsorPot: 2n * USDC, recordsMisses: true }}
            backers={[]}
            stake={10n * USDC}
            potLine={potLineOf({ stake: 10n * USDC, stakers: 0, extra: 2n * USDC })}
          />
        </div>
      </StateFrame>

      <StateFrame name="challenge-accept-no-terms" note="a read missed: no invented terms, no seed figure">
        <div className={PAGE_COLUMN}>
          <ChallengeIntro
            kind="self"
            challengerName="0x8a39...6141"
            targetHandle={null}
            message={null}
            terms={null}
            backers={[]}
          />
        </div>
      </StateFrame>

      <StateFrame name="challenge-grow" note="/c/[token] under the lobby: chip in and rally, while it can pay">
        <div className={`${PAGE_COLUMN} [&>*+*]:mt-8`}>
          <RallyCard token="fixture-token-0000000000000000" name="mika.gohealthme.eth" />
        </div>
      </StateFrame>

      <StateFrame name="chip-in-warnings" note="the one chip-in warning, per bounty model and viewer">
        <div className={`${PAGE_COLUMN} [&>*+*]:mt-4`}>
          <ChipInWarning bountyModel={2} creator={{ name: "0xA56e...7F2D", you: false }} selfStake={false} stakers={3} />
          <ChipInWarning bountyModel={2} creator={{ name: "mika.gohealthme.eth", you: false }} selfStake stakers={1} />
          <ChipInWarning bountyModel={0} creator={{ name: "acme.gohealthme.eth", you: false }} selfStake={false} stakers={4} />
          <ChipInWarning bountyModel={1} creator={{ name: "acme.gohealthme.eth", you: false }} selfStake={false} stakers={4} />
          <ChipInWarning bountyModel={2} creator={{ name: "mika.gohealthme.eth", you: true }} selfStake stakers={1} />
        </div>
      </StateFrame>

      <StateFrame name="challenge-paused" note="the challenge cannot be paid on this build: no chip-in">
        <div className={PAGE_COLUMN}>
          <ChallengePausedCard reason="payouts" />
        </div>
      </StateFrame>

      <StateFrame name="challenge-backer" note="/c/[token]?as=backer: chip in, never accept">
        <BackerView
          token="fixture-token-0000000000000000"
          poolId={44n}
          challengerName="mika.gohealthme.eth"
          message="You said you'd start Monday. It's Monday."
          pot={{ prize: 7n * USDC, stakes: 1n * USDC, seed: 5n * USDC }}
          backers={["nikki.gohealthme.eth"]}
          canGrow
          chipIn={{ bountyModel: 2, creator: { name: "mika.gohealthme.eth", you: false }, selfStake: false, stakers: 1 }}
        />
      </StateFrame>

      <StateFrame name="challenge-backer-self" note="the Back me link: Back {name}, and a lone staker gets the chip-in hit or miss">
        <BackerView
          token="fixture-token-0000000000000000"
          poolId={45n}
          challengerName="mika.gohealthme.eth"
          message={null}
          pot={{ prize: 2n * USDC, stakes: 1n * USDC, seed: 0n }}
          backers={["nikki.gohealthme.eth"]}
          canGrow
          chipIn={{ bountyModel: 2, creator: { name: "mika.gohealthme.eth", you: false }, selfStake: true, stakers: 1 }}
        />
      </StateFrame>

      <StateFrame name="challenge-backer-closed" note="window closed, paid out, or cannot pay here">
        <BackerView
          token="fixture-token-0000000000000000"
          poolId={44n}
          challengerName="mika.gohealthme.eth"
          message={null}
          pot={{ prize: null, stakes: null, seed: null }}
          backers={[]}
          canGrow={false}
          chipIn={{ bountyModel: 2, creator: { name: "mika.gohealthme.eth", you: false }, selfStake: false, stakers: null }}
        />
      </StateFrame>

      <StateFrame name="challenge-invalid" note="a mistyped or vanished link">
        <ChallengeInvalid />
      </StateFrame>

      <StateFrame name="challenge-invite" note="stake on yourself, the creator's links before the one signature">
        <div className={PAGE_COLUMN}>
          <Card>
            <h2 className="m-0 text-[1.0625rem] font-semibold">{inviteShareOf("self").heading}</h2>
            <div className="mt-3">
              <ChallengeInviteShare poolId={45n} address="0x8a39000000000000000000000000000000006141" kind="self" />
            </div>
          </Card>
        </div>
      </StateFrame>

      <StateFrame name="challenge-invite-links" note="stake on yourself, after the signature: Match my stake and Back me">
        <div className={PAGE_COLUMN}>
          <Card>
            <h2 className="m-0 text-[1.0625rem] font-semibold">{inviteShareOf("self").heading}</h2>
            <div className="mt-3">
              <InviteLinks links={selfLinks} token="fixture-token-0000000000000000" />
            </div>
          </Card>
        </div>
      </StateFrame>

      <StateFrame name="challenge-invite-unstaked" note="stake on yourself, creator not locked in yet: no link, and why">
        <div className={PAGE_COLUMN}>
          <Card>
            <h2 className="m-0 text-[1.0625rem] font-semibold">{inviteShareOf("unstaked").heading}</h2>
            <div className="mt-3">
              <ChallengeInviteShare poolId={46n} address="0x8a39000000000000000000000000000000006141" kind="unstaked" />
            </div>
          </Card>
        </div>
      </StateFrame>

      <StateFrame name="challenges-signin-off" note="a build with sign-in off">
        <Frame
          pose="meditate"
          first={
            <EmptyCard
              title="Sign-in is off on this build"
              detail="Challenges need a signed-in wallet, and this build has sign-in off. Nothing is wrong on your side. The open challenges are still there to look at."
              action={
                <Link href="/pools" className={PRIMARY_LINK}>
                  See the open challenges
                </Link>
              }
            />
          }
        />
      </StateFrame>
    </GallerySection>
  );
}
