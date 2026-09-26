import type { Metadata } from "next";
import ChallengeAccept from "@/components/ChallengeAccept";
import ChallengeContribute from "@/components/ChallengeContribute";
import Lobby from "@/components/game/Lobby";
import {
  BackerView,
  ChallengeIntro,
  ChallengeInvalid,
  ChallengePausedCard,
  RallyCard,
} from "@/components/challenges/ChallengeLanding";
import { PAGE_COLUMN } from "@/components/night/kit";
import {
  fetchParticipants,
  fetchPool,
  formatUsdc,
  type PoolInfo,
} from "@/lib/contract";
import {
  challengePauseReason,
  darePot,
  isBackerView,
} from "@/lib/challenges";
import { poolCanPay, poolPhase } from "@/lib/pool-lifecycle";
import { approvalModeStatus } from "@/lib/server/agent/approval-mode-status";
import { getChallengeByToken } from "@/lib/server/challenges";
import { fetchPoolFunding, type PoolFunding } from "@/lib/server/pool-funders";
import { documentProofStatus } from "@/lib/server/proof-status";
import {
  getProfileByAddress,
  resolveProfiles,
} from "@/lib/server/social-profile";
import { NOINDEX } from "@/lib/site";
import { displayNameFor } from "@/lib/social";

// The token is a bearer capability and the row is looked up live per request,
// so the page is always dynamic and never cached at the edge.
export const dynamic = "force-dynamic";

// Reading the request-time clock is legitimate in a dynamic server component,
// but it must not sit inline in the component body (React's purity rule treats
// Date.now as impure in render). This module-scope helper keeps the impure read
// out of the render path while still evaluating per request.
function nowUnixSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

// This is a private, person-aimed link. It must never be indexed, and its
// title/description must never leak the goal (which is health-adjacent) into a
// search result or a link-preview card. The goal is visible ON the page only,
// behind the unguessable token. Title stays deliberately neutral.
export const metadata: Metadata = {
  title: "You've been challenged",
  robots: NOINDEX,
};

export default async function ChallengeLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const backer = isBackerView((await searchParams).as);

  const challenge = await getChallengeByToken(token);
  if (challenge === null) return <ChallengeInvalid />;

  let poolIdBig: bigint;
  try {
    poolIdBig = BigInt(challenge.poolId);
  } catch {
    return <ChallengeInvalid />;
  }

  // The goal and the reward are read LIVE from the chain, never from the
  // challenges row. If the pool cannot be read, treat the link as unresolvable
  // rather than rendering a challenge with no goal or reward.
  let pool: PoolInfo;
  let phase: ReturnType<typeof poolPhase>;
  let canPay: boolean;
  try {
    pool = await fetchPool(poolIdBig);
    canPay = poolCanPay(pool);
    phase = poolPhase(pool, nowUnixSeconds());
  } catch {
    return <ChallengeInvalid />;
  }

  // Checked on the server, from the same facts the judge and the approval gate
  // decide on: a challenge whose win could not pay (or an older document
  // challenge while the checker is off) takes no more money from anyone. A
  // wearable challenge never waits on the document checker. The accept control
  // shows the same limit as a lock (lib/game/lobby.ts); this stops the chip-in
  // and the rally.
  const pauseReason = challengePauseReason({
    goalSpec: pool.goalSpec,
    documentCheckerAvailable: documentProofStatus().available,
    payoutsMisconfigured:
      approvalModeStatus("challenge-page") === "misconfigured",
  });

  // Resolve the challenger to a handle when they have claimed one; otherwise
  // show the truncated address. This is public identity, never a health label.
  const challengerProfile = await getProfileByAddress(challenge.challengerAddress);
  const challengerName = displayNameFor(
    challenge.challengerAddress,
    challengerProfile?.handle ?? null,
  );

  // Best-effort reads for the money line. A miss leaves that figure unknown
  // (PrizeLine then says less), never wrong.
  const [participantCount, funding] = await Promise.all([
    fetchParticipants(poolIdBig)
      .then((list) => list.length)
      .catch(() => null),
    fetchPoolFunding(poolIdBig).catch((): PoolFunding | null => null),
  ]);
  const pot = darePot({
    balance: pool.balance,
    entryFee: pool.entryFee,
    participantCount,
    settled: pool.settled,
    cancelled: pool.cancelled,
    contributed: funding?.total ?? null,
  });

  // Contributors who chipped in via fundPool, named by @handle. createPool does
  // NOT emit PoolFunded, so this is only the friends who sweetened the pot AFTER
  // creation - never the challenger, who is already named above.
  let contributorNames: string[] = [];
  if (funding !== null && funding.funders.length > 0) {
    try {
      const resolved = await resolveProfiles(funding.funders);
      contributorNames = funding.funders.map((funder) =>
        displayNameFor(funder, resolved.get(funder.toLowerCase())?.handle ?? null),
      );
    } catch {
      contributorNames = [];
    }
  }

  // Friends can grow the pot and rally more friends only while the challenge is
  // live, can actually pay, and can be checked and paid on this build. The
  // same gate the accept block uses.
  const paused = pauseReason !== null;
  const canGrow = phase === "live" && canPay && !paused;

  // The commitment terms before the accept, only for a commitment pool
  // (bountyModel 2) that is live, can pay and is not paused, and only from
  // numbers read from chain: the entry fee, the players already in and the
  // sponsor pot (balance net of stakes). A missed read shows no terms rather
  // than invented ones.
  const terms =
    pool.bountyModel === 2 &&
    phase === "live" &&
    canPay &&
    !paused &&
    participantCount !== null &&
    pot.prize !== null
      ? { entryFee: pool.entryFee, players: participantCount, sponsorPot: pot.prize }
      : null;

  const target =
    challenge.targetHandle !== null ? `@${challenge.targetHandle}` : "their friend";

  if (backer) {
    return (
      <BackerView
        token={token}
        poolId={poolIdBig}
        challengerName={challengerName}
        target={target}
        message={challenge.message}
        pot={pot}
        backers={contributorNames}
        canGrow={canGrow}
      />
    );
  }

  // The challenge leads the same Lobby component /pools renders, with this run
  // highlighted and its accept control inside the slip. The lock logic is the
  // lobby's, so the challenge link and the board can never disagree.
  return (
    <div className={`${PAGE_COLUMN} space-y-8`}>
      <Lobby
        highlightId={challenge.poolId}
        returnTo={`/c/${token}`}
        intro={
          <ChallengeIntro
            challengerName={challengerName}
            seed={pot.seed}
            targetHandle={challenge.targetHandle}
            message={challenge.message}
            terms={terms}
            backers={contributorNames}
          />
        }
        highlightAction={
          <ChallengeAccept poolId={challenge.poolId} returnTo={`/c/${token}`} />
        }
      />

      {canGrow ? (
        <>
          <ChallengeContribute
            poolId={poolIdBig}
            prizeUsd={pot.prize !== null ? formatUsdc(pot.prize) : null}
          />
          <RallyCard token={token} />
        </>
      ) : phase === "live" && canPay && pauseReason !== null ? (
        <ChallengePausedCard reason={pauseReason} />
      ) : null}
    </div>
  );
}
