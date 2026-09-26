import type { Metadata } from "next";
import Link from "next/link";
import ChallengeAccept from "@/components/ChallengeAccept";
import ChallengeContribute from "@/components/ChallengeContribute";
import ShareChallenge from "@/components/ShareChallenge";
import SpotterSays from "@/components/SpotterSays";
import Lobby from "@/components/game/Lobby";
import { CommitmentTermsList } from "@/components/CommitmentTerms";
import Spotter from "@/components/spotter/Spotter";
import { EmptyState, Money, buttonClasses } from "@/components/ui";
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
  type DarePot,
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

// The primary button look (components/ui buttonClasses) for a Link.
const PRIMARY_LINK = `${buttonClasses({ size: "sm" })}`;

// Display headline: Bricolage 800, tight, and wrapping (never overflowing) a
// long @handle at 360px.
const HEADLINE =
  "break-words font-display text-[2.5rem] font-extrabold leading-display tracking-display sm:text-[4rem]";

// This is a private, person-aimed link. It must never be indexed, and its
// title/description must never leak the goal (which is health-adjacent) into a
// search result or a link-preview card. The goal is visible ON the page only,
// behind the unguessable token. Title stays deliberately neutral.
export const metadata: Metadata = {
  title: "You've been challenged",
  robots: NOINDEX,
};

/** A friendly dead-end for a bad or expired-from-existence link, with no leak
 *  of whether any given token exists beyond "this one does not resolve". */
function InvalidLink() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-10 text-center">
      <Spotter
        state="confirmation-declined"
        size="lg"
        line="This link goes nowhere. I checked twice."
      />
      <h1 className="mt-6 break-words font-display text-[2.5rem] font-extrabold leading-display tracking-display">
        This challenge link does not open
      </h1>
      <p className="mt-3 text-base text-foreground/80">
        It may have been mistyped, or the challenge no longer exists. Ask whoever
        sent it for a fresh link.
      </p>
      <Link href="/pools" className={`mt-6 ${PRIMARY_LINK}`}>
        Go to the lobby
      </Link>
    </div>
  );
}

/** The backer's money line. pool.balance counts every player's own stake, so
 *  the pot is stated net of stakes and the challenger's seed is split from
 *  friends' top-ups. No figure at all when it cannot be stated honestly
 *  (settled, cancelled, or a read missed). */
function PotLine({ pot }: { pot: DarePot }) {
  if (pot.prize === null) return null;
  const fromFriends =
    pot.seed !== null && pot.prize > pot.seed ? pot.prize - pot.seed : 0n;
  return (
    <p className="text-base text-foreground/80">
      In the pot: <Money usd={formatUsdc(pot.prize)} size="md" />
      {fromFriends > 0n ? ` (${formatUsdc(fromFriends)} of it from backers)` : ""}
      , shared by the players who hit the goal on top of their own stake back.
    </p>
  );
}

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
  if (challenge === null) return <InvalidLink />;

  let poolIdBig: bigint;
  try {
    poolIdBig = BigInt(challenge.poolId);
  } catch {
    return <InvalidLink />;
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
    return <InvalidLink />;
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

  const headline =
    pot.seed !== null && pot.seed > 0n
      ? `${challengerName} put ${formatUsdc(pot.seed)} USDC on you`
      : `${challengerName} challenged you`;
  const target =
    challenge.targetHandle !== null ? `@${challenge.targetHandle}` : "their friend";

  const backedBy =
    contributorNames.length > 0 ? (
      <p className="text-sm text-muted">
        Backed by{" "}
        <span className="font-semibold text-foreground">
          {contributorNames.slice(0, 3).join(", ")}
        </span>
        {contributorNames.length > 3 ? ` and ${contributorNames.length - 3} more` : ""}
      </p>
    ) : null;

  const rally = (
    <div className="space-y-3 rounded-3xl border border-edge bg-surface p-5 sm:p-6">
      <div className="space-y-1">
        <h2 className="font-display text-[1.75rem] font-extrabold leading-display tracking-display">
          Rally your friends
        </h2>
        <p className="text-sm text-muted">
          This link opens as a backer page: friends can chip in to grow the
          pot, and it never signs them up for the challenge.
        </p>
      </div>
      <ShareChallenge
        token={token}
        backer
        title="Back this challenge on GoHealthMe"
        message="Back this challenge. There is test USDC riding on hitting the goal. Chip in and grow the pot:"
        emailSubject="Back this challenge"
        shareLabel="Rally friends"
      />
    </div>
  );

  // BACKER VIEW: the rally link. Leads with chipping in, never offers accept,
  // so a friend who came to help is never staked into the dare as a player.
  if (backer) {
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-4">
          <p className="text-sm font-semibold text-accent-deep">Back the challenge</p>
          <h1 className={HEADLINE}>
            {challengerName} challenged {target}
          </h1>
          {challenge.message !== null ? (
            <blockquote className="border-l-4 border-accent pl-4 text-lg text-foreground/90">
              {challenge.message}
            </blockquote>
          ) : null}
          <PotLine pot={pot} />
          {backedBy}
        </header>

        {canGrow ? (
          <>
            <ChallengeContribute
              poolId={poolIdBig}
              prizeUsd={pot.prize !== null ? formatUsdc(pot.prize) : null}
            />
            {rally}
          </>
        ) : (
          <EmptyState
            title="This challenge is not taking backers anymore"
            detail="Its window has closed, it has already paid out, or I cannot check or pay it on this build, so nothing can be added. Nothing was charged."
            line="Pot's closed. I'm on break."
            action={
              <Link href="/pools" className={PRIMARY_LINK}>
                Go to the lobby
              </Link>
            }
          />
        )}

        <p className="text-sm text-muted">
          Are you the one who got challenged?{" "}
          <Link
            href={`/c/${token}`}
            className="font-semibold text-accent-deep underline underline-offset-2"
          >
            Open the challenge to accept it
          </Link>
        </p>
      </div>
    );
  }

  // The dare leads the same Lobby component /pools renders, with this run
  // highlighted and its accept control inside the slip. The lock logic is the
  // lobby's, so the dare link and the board can never disagree.
  const intro = (
    <header className="space-y-4">
      <p className="text-sm font-semibold text-accent-deep">You have been challenged</p>
      <h1 className={HEADLINE}>{headline}</h1>
      {challenge.targetHandle !== null ? (
        <p className="text-sm text-muted">For {challenge.targetHandle}</p>
      ) : null}
      {challenge.message !== null ? (
        <blockquote className="border-l-4 border-accent pl-4 text-lg text-foreground/90">
          {challenge.message}
        </blockquote>
      ) : null}
      {terms !== null ? (
        <div className="rounded-3xl border border-edge bg-surface p-5">
          <CommitmentTermsList
            entryFee={terms.entryFee}
            players={terms.players}
            sponsorPot={terms.sponsorPot}
          />
        </div>
      ) : null}
      {backedBy}
      <SpotterSays
        surface="join"
        state="joined"
        pose="cheer"
        say="Accept and your stake goes in. Hit it and it comes back, with a share of the pot. Only the yes or no verdict goes on chain, never your data."
      />
    </header>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Lobby
        highlightId={challenge.poolId}
        returnTo={`/c/${token}`}
        intro={intro}
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
          {rally}
        </>
      ) : phase === "live" && canPay && paused ? (
        <div
          role="status"
          className="flex flex-col items-center gap-4 rounded-3xl border border-edge bg-surface-raised p-5 text-center sm:flex-row sm:items-end sm:text-left"
        >
          <Spotter
            state="error"
            size="sm"
            line={
              pauseReason === "checker"
                ? "My checker is off. So is the pot."
                : "I can't pay this out yet. So I'm not taking money for it."
            }
          />
          <div className="space-y-2 sm:pb-2">
            <p className="font-display text-xl font-bold leading-display">
              Chipping in is paused too
            </p>
            <p className="text-sm text-foreground/80">
              I am not taking anyone&apos;s money for a challenge I cannot{" "}
              {pauseReason === "checker" ? "check" : "pay out"} right now.
              Nothing has been charged.
              {pauseReason === "checker"
                ? " Wearable runs in the lobby still work."
                : ""}
            </p>
            <Link href="/pools" className={`mt-1 ${PRIMARY_LINK}`}>
              {pauseReason === "checker" ? "Find a wearable run" : "Go to the lobby"}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
