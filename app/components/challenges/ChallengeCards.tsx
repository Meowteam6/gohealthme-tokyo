// The challenges page's cards and frame (docs/DESIGN.md, Night Shift): one
// card per challenge with its tag and live clock, the goal in Figtree, the
// reward and lock-in in gold, and the one action. The page (app/challenges)
// owns every chain read; this file only draws what it read, so the dev
// gallery can render each state from fixtures.

import Link from "next/link";
import type { ReactNode } from "react";
import Countdown from "@/components/Countdown";
import {
  CARD_TITLE,
  Notice,
  PAGE_COLUMN,
  PerchedHeader,
  SECTION_TITLE,
} from "@/components/night/kit";
import { Badge, Card, Stat, StatRow, Tag, buttonClasses } from "@/components/ui";
import { displayGoalSpec, formatUsdc, type ParticipantInfo, type PoolInfo } from "@/lib/contract";
import { challengeAwaitingSettleStatus, type ProofTier } from "@/lib/proof-tier";
import { darePot } from "@/lib/challenges";
import type { NightPose } from "@/lib/spotter-poses";

// The shared button looks (components/ui buttonClasses), for Links.
export const PRIMARY_LINK = `${buttonClasses({ size: "sm" })} w-full sm:w-auto`;
export const GHOST_LINK = `${buttonClasses({ variant: "secondary", size: "sm" })} w-full sm:w-auto`;
/** A challenge's goal on its card: Figtree, like a run's name on its card. */
const GOAL_TITLE =
  "m-0 mt-1.5 break-words text-[1.1875rem] font-semibold leading-snug tracking-[-0.01em] text-foreground";


export interface InChallenge {
  pool: PoolInfo;
  participant: ParticipantInfo;
  /** Players in the pool, so the reward is shown net of their own stakes.
   *  null when the count read missed. */
  participantCount: number | null;
  /** On-chain trust tier for a recorded-but-unsettled challenge, so its status
   *  badge never reads "Verified" for a self-reported claim. null when the
   *  challenge has no pending passing verdict (status does not need it). */
  tier: ProofTier | null;
}

export interface SentChallenge {
  pool: PoolInfo;
  /** Accepters, or null when the count read missed (the card still renders). */
  participantCount: number | null;
  /** Whether YOU staked into your own pool. A commitment you staked on yourself
   *  reads differently from a reward you put up for a friend, and the two are
   *  the same on-chain object (a bountyModel-2 pool), so the creator's own
   *  participation is what tells them apart. */
  selfStaked: boolean;
}

export interface MyChallenges {
  inChallenges: InChallenge[];
  sentChallenges: SentChallenge[];
}


/** A challenge aimed at you that you have NOT yet accepted, resolved against chain. */
export interface InvitedChallenge {
  pool: PoolInfo;
  /** Players already in, so the reward excludes their stakes. */
  participantCount: number | null;
  inviteToken: string;
  challengerAddress: string;
  message: string | null;
}


/** The money stats for a challenge card: the stake every player puts in and
 *  the one Pot figure, which is all the money in the challenge (every stake
 *  plus any extra, pool.balance while live). A settled or cancelled pool's
 *  balance is payouts and refunds, so it gets a state word instead. */
export function rewardStats(pool: PoolInfo, participantCount: number | null): ReactNode[] {
  if (pool.cancelled) {
    return [<Stat key="state" label="Status" value="Cancelled, stakes refundable" />];
  }
  if (pool.settled) return [<Stat key="state" label="Status" value="Settled" />];
  const stats: ReactNode[] = [
    <Stat key="stake" label="Stake" value={formatUsdc(pool.entryFee)} unit="USDC" tone="money" />,
  ];
  // A count that did not read leaves the Pot unstated rather than guessed.
  if (participantCount !== null) {
    stats.push(<Stat key="pot" label="Pot" value={formatUsdc(pool.balance)} unit="USDC" tone="money" />);
  }
  return stats;
}

/** The top row of every challenge card: its tag left, the live clock right,
 *  the way the run card carries "Ends Sun 08:30". */
export function CardTop({ tag, pool }: { tag: ReactNode; pool: PoolInfo }) {
  return (
    <div className="flex items-center justify-between gap-3">
      {tag}
      <span className="num text-right text-[0.8125rem] text-haze">
        <Countdown periodStart={pool.periodStart} periodEnd={pool.periodEnd} />
      </span>
    </div>
  );
}


/** The participant's standing on a challenge they are in, read from the chain
 *  alone: recorded + verdict + settled is all it takes to say where the money
 *  is. Labels match the page's stated set (Not started / awaiting settle / Paid)
 *  plus the honest "Goal missed" the contract can also report. */
export function challengeStatus(
  pool: PoolInfo,
  p: ParticipantInfo,
  tier: ProofTier | null,
): { label: string; tone: "accent" | "muted" | "warning" } {
  if (p.resultRecorded && p.verdict) {
    // Awaiting settle: a self-reported challenge is a real, pending win but must
    // never read "Verified". Its tier decides the badge.
    return pool.settled
      ? { label: "Paid", tone: "accent" }
      : challengeAwaitingSettleStatus(tier);
  }
  if (p.resultRecorded && !p.verdict) {
    return { label: "Goal missed", tone: "muted" };
  }
  return { label: "Not started", tone: "warning" };
}

export function InvitedChallengeCard({
  entry,
  challengerName,
  acceptUrl,
}: {
  entry: InvitedChallenge;
  challengerName: string;
  acceptUrl: string;
}) {
  const { pool, message } = entry;

  return (
    <Card as="article">
      <CardTop pool={pool} tag={<Tag>Invited</Tag>} />
      <p className="m-0 mt-3 text-[0.9375rem] text-muted">
        <span className="font-semibold text-foreground">{challengerName}</span>{" "}
        challenged you
      </p>
      <h3 className={GOAL_TITLE}>{displayGoalSpec(pool.goalSpec)}</h3>
      {message !== null ? (
        <p className="m-0 mt-2 border-l-2 border-edge-strong pl-3 text-[0.9375rem] text-muted">
          {message}
        </p>
      ) : null}
      <StatRow className="mt-3 border-t border-edge pt-3">
        {rewardStats(pool, entry.participantCount)}
      </StatRow>
      <Link href={acceptUrl} className={`mt-4 ${PRIMARY_LINK}`}>
        Accept the challenge
      </Link>
    </Card>
  );
}

export function InChallengeCard({
  entry,
  challengerName,
}: {
  entry: InChallenge;
  challengerName: string;
}) {
  const { pool, participant } = entry;
  const status = challengeStatus(pool, participant, entry.tier);
  // Nothing recorded yet means the result is still owed - lead with the run.
  const needsProof = !participant.resultRecorded;
  const id = pool.id.toString();

  return (
    <Card as="article">
      <CardTop pool={pool} tag={<Tag tone="muted" dot={false}>Challenge</Tag>} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[0.9375rem] text-muted">
          <span className="font-semibold text-foreground">{challengerName}</span>{" "}
          challenged you
        </p>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <h3 className={GOAL_TITLE}>{displayGoalSpec(pool.goalSpec)}</h3>
      <StatRow className="mt-3 border-t border-edge pt-3">
        {rewardStats(pool, entry.participantCount)}
      </StatRow>
      <Link
        href={`/pools/${id}`}
        className={`mt-4 ${needsProof ? PRIMARY_LINK : GHOST_LINK}`}
      >
        {needsProof ? "Open your challenge" : "View challenge"}
      </Link>
    </Card>
  );
}

export function SentChallengeCard({ entry }: { entry: SentChallenge }) {
  const { pool, participantCount, selfStaked } = entry;
  const id = pool.id.toString();
  // Whether you are in reads from your own stake. A challenge with no money
  // beyond the stakes and no stake of yours is waiting for you to lock in.
  // With money beyond the stakes and no stake of yours it is either an older
  // reward challenge or a new one whose extra went in at create; the card says
  // only what is true of both. The money stats are the same either way: the
  // stake and the one Pot.
  //
  // "Beyond the stakes" is balance net of every player's stake, not a raw
  // zero balance: friends who staked before the creator did put their own
  // money in.
  const netReward = darePot({
    balance: pool.balance,
    entryFee: pool.entryFee,
    participantCount,
    settled: pool.settled,
    cancelled: pool.cancelled,
  }).prize;
  const commitment =
    selfStaked ||
    (!pool.settled &&
      (netReward !== null ? netReward === 0n : pool.balance === 0n));
  const countLabel =
    participantCount === null
      ? null
      : participantCount === 0
        ? commitment
          ? "Stake to lock it in"
          : "No one has staked yet"
        : participantCount === 1
          ? selfStaked
            ? "Just you so far"
            : "1 person staked"
          : `${participantCount} people staked`;

  return (
    <Card as="article">
      <CardTop
        pool={pool}
        tag={
          <Tag tone="muted" dot={false}>
            Challenge
          </Tag>
        }
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[0.9375rem] text-muted">
          {/* Money in and no stake of yours is either an older reward
              challenge or a new one you have not locked in yet; the chain
              cannot tell them apart, so the line says only what is true of
              both. */}
          {selfStaked
            ? "You are in. Friends match your stake"
            : commitment
              ? "Lock in your stake to start"
              : "You put money in and have not staked yet"}
        </p>
        {pool.settled ? <Badge tone="muted">Settled</Badge> : null}
      </div>
      <h3 className={GOAL_TITLE}>{displayGoalSpec(pool.goalSpec)}</h3>
      <StatRow className="mt-3 border-t border-edge pt-3">
        {rewardStats(pool, participantCount)}
      </StatRow>
      {countLabel !== null ? (
        <p className="m-0 mt-3 text-[0.9375rem] text-muted">{countLabel}</p>
      ) : null}
      <Link href={`/pools/${id}`} className={`mt-4 ${GHOST_LINK}`}>
        View challenge
      </Link>
    </Card>
  );
}


export const PAUSED_TITLE = "Challenges are paused for now";

/** The one action that starts something. When challenges are paused on this
 *  build it points at the open runs instead of a form that would refuse. */
export function StartAction({ paused }: { paused: boolean }) {
  return paused ? (
    <Link href="/pools" className={PRIMARY_LINK}>
      See the open challenges
    </Link>
  ) : (
    <Link href="/challenge/new" className={PRIMARY_LINK}>
      Start a challenge
    </Link>
  );
}

export const PAGE_LEAD =
  "Challenges you started and the ones friends sent you. Base Sepolia test USDC.";

/** The page frame: the title, and SPOTTER standing on the first card in the
 *  pose that fits the page's state (one pose on the screen). */
export function Frame({
  pose,
  lead = PAGE_LEAD,
  first,
  children,
}: {
  pose: NightPose;
  lead?: string;
  /** The first card, the one he stands on. */
  first: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`${PAGE_COLUMN} [&>*+*]:mt-10`}>
      <PerchedHeader title="Your challenges" lead={lead} pose={pose}>
        {first}
      </PerchedHeader>
      {children}
    </div>
  );
}

/** The card at the top of a page that has challenges: the one action that
 *  starts another, or the plain reason challenges are paused. */
export function StartCard({ pause }: { pause: { detail: string } | null }) {
  return (
    <Card>
      {pause !== null ? (
        <Notice tone="limit" title={PAUSED_TITLE} role="status">
          {pause.detail}
        </Notice>
      ) : (
        <>
          <h2 className={CARD_TITLE}>Start another</h2>
          <p className="m-0 mt-1.5 text-[0.9375rem] leading-[1.5] text-muted">
            Put money on your own goal and challenge a friend to match it. Your
            wearable decides.
          </p>
        </>
      )}
      <div className="mt-4">
        <StartAction paused={pause !== null} />
      </div>
    </Card>
  );
}

/** A section's title and its one-line lead. */
export function SectionHead({ title, lead }: { title: string; lead: string }) {
  return (
    <div>
      <h2 className={SECTION_TITLE}>{title}</h2>
      <p className="m-0 mt-2 max-w-[60ch] text-[0.9375rem] leading-[1.5] text-muted">{lead}</p>
    </div>
  );
}

