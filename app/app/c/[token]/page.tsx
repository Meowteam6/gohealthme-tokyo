import type { Metadata } from "next";
import Link from "next/link";
import ChallengeAccept from "@/components/ChallengeAccept";
import ChallengeContribute from "@/components/ChallengeContribute";
import ShareChallenge from "@/components/ShareChallenge";
import SpotterSays from "@/components/SpotterSays";
import Lobby from "@/components/game/Lobby";
import { TAP_TARGET } from "@/components/ui";
import { fetchPool, formatUsdc } from "@/lib/contract";
import { poolCanPay, poolPhase } from "@/lib/pool-lifecycle";
import { getChallengeByToken } from "@/lib/server/challenges";
import { fetchPoolFunders } from "@/lib/server/pool-funders";
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

/** A friendly dead-end for a bad or expired-from-existence link, with no leak
 *  of whether any given token exists beyond "this one does not resolve". */
function InvalidLink() {
  return (
    <div className="mx-auto max-w-md py-12">
      <h1 className="font-display text-5xl font-black leading-[0.95]">
        This dare link does not open
      </h1>
      <p className="mt-3 text-base text-foreground/80">
        It may have been mistyped, or the dare no longer exists. Ask whoever
        sent it for a fresh link.
      </p>
      <Link
        href="/pools"
        className={`mt-6 rounded-lg bg-accent font-semibold text-white hover:bg-accent-strong ${TAP_TARGET}`}
      >
        Go to the lobby
      </Link>
    </div>
  );
}

export default async function ChallengeLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

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
  let rewardUsd: string;
  let phase: ReturnType<typeof poolPhase>;
  let canPay: boolean;
  try {
    const pool = await fetchPool(poolIdBig);
    rewardUsd = formatUsdc(pool.balance);
    canPay = poolCanPay(pool);
    phase = poolPhase(pool, nowUnixSeconds());
  } catch {
    return <InvalidLink />;
  }

  // Resolve the challenger to a handle when they have claimed one; otherwise
  // show the truncated address. This is public identity, never a health label.
  const challengerProfile = await getProfileByAddress(challenge.challengerAddress);
  const challengerName = displayNameFor(
    challenge.challengerAddress,
    challengerProfile?.handle ?? null,
  );

  // Contributors who chipped in via fundPool, named by @handle. createPool does
  // NOT emit PoolFunded, so this is only the friends who sweetened the pot AFTER
  // creation - never the challenger, who is already named above. Best-effort:
  // any read failure just hides the strip rather than failing the landing.
  let contributorNames: string[] = [];
  try {
    const funders = await fetchPoolFunders(poolIdBig);
    if (funders.length > 0) {
      const resolved = await resolveProfiles(funders);
      contributorNames = funders.map((funder) =>
        displayNameFor(funder, resolved.get(funder.toLowerCase())?.handle ?? null),
      );
    }
  } catch {
    contributorNames = [];
  }

  // Friends can grow the pot and rally more friends only while the challenge is
  // live and can actually pay. The same gate the accept block uses.
  const canGrow = phase === "live" && canPay;

  // The dare leads the same Lobby component /pools renders, with this run
  // highlighted and its accept control inside the slip. The lock logic is the
  // lobby's, so the dare link and the board can never disagree.
  const intro = (
    <header className="space-y-4">
      <p className="text-sm font-semibold text-accent">You have been dared</p>
      <h1 className="font-display text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl">
        {challengerName} put {rewardUsd} USDC on you
      </h1>
      {challenge.targetHandle !== null ? (
        <p className="text-sm text-muted">For {challenge.targetHandle}</p>
      ) : null}
      {challenge.message !== null ? (
        <blockquote className="border-l-4 border-accent pl-4 text-lg text-foreground/90">
          {challenge.message}
        </blockquote>
      ) : null}
      {contributorNames.length > 0 ? (
        <p className="text-sm text-muted">
          Backed by{" "}
          <span className="font-semibold text-foreground">
            {contributorNames.slice(0, 3).join(", ")}
          </span>
          {contributorNames.length > 3 ? ` and ${contributorNames.length - 3} more` : ""}
        </p>
      ) : null}
      <SpotterSays
        surface="join"
        state="joined"
        pose="cheer"
        say="Accept and your stake goes in. Hit it and it comes back with the prize. Only the yes or no verdict goes on chain, never your data."
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
          <ChallengeContribute poolId={poolIdBig} potUsd={rewardUsd} />

          <div className="space-y-3 rounded-xl border-2 border-foreground/15 bg-surface p-5">
            <div className="space-y-1">
              <h2 className="font-display text-2xl font-extrabold">Rally your boys</h2>
              <p className="text-sm text-muted">
                Send this to people who want you to win. They can chip in and
                grow the prize you collect when you hit the goal.
              </p>
            </div>
            <ShareChallenge
              token={token}
              title="Back me on GoHealthMe"
              message="Back me on this - I've got USDC riding on hitting my goal. Chip in and help me get there:"
              emailSubject="Back me on this"
              shareLabel="Rally friends"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
