"use client";

// "My challenges" - the two-sided home for the peer-challenge layer.
//
// A challenge IS a pool (initiative === "challenge"): the challenger creates
// and funds it, the target accepts the /c/[token] link by calling joinPool.
// Before this page there was nowhere in the app to see that challenge again -
// who dared you, what the dare was, whether it has paid - once the invite link
// was gone. Both sides live here now.
//
// RELIABLE READS ONLY. Everything on this page is discovered the way the
// dashboard discovers joined pools: fetchPools() enumerates poolCount (the
// fixed, non-getLogs path) and getParticipant / getParticipants are plain
// eth_call view reads. There is deliberately NO getLogs / event scan here -
// Arc's public RPCs cannot serve those from the browser.
//
// WHO CHALLENGED YOU is derived, never stored: the challenger is the pool's
// on-chain creator (pool.creator), resolved to an @handle by the same
// display-name resolver the rest of the app uses, falling back to a truncated
// address. The dare is the on-chain goalSpec (rendered through displayGoalSpec,
// which strips the [doc] marker). Nothing health-adjacent is read from any
// off-chain source.
//
// INVITED TO YOU is the one section that starts off-chain. A challenger can aim
// a dare at your @handle at creation; that (handle -> invite token) row is the
// only place the aim is recorded. /api/challenges/invited returns those invites
// ONLY to the signature-verified owner of the handle, so the token - a
// capability that unlocks the goal - never reaches anyone else. Everything shown
// on the card is then read the same reliable way as the rest of the page:
// fetchPool (an eth_call) for the goal, reward and window, fetchParticipant to
// drop any dare you have already accepted. Still no getLogs.
//
// PRIVACY. The dare is health-adjacent, but this is the participant's and the
// creator's OWN challenges page - they are entitled to see their own goal text.
// The public redaction rule (feed / profile / pool metadata) is untouched.

import { SignInLoadingCard } from "@/components/night/SlowSignInNotice";
import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import SignInPanel from "@/components/SignInPanel";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { useApprovalProbe } from "@/components/game/ApprovalNote";
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
  type InChallenge,
  type InvitedChallenge,
  type MyChallenges,
  type SentChallenge,
} from "@/components/challenges/ChallengeCards";
import {
  challengeCreateBlock,
  payoutStateOf,
} from "@/lib/game/join-checks";
import { Card, ErrorNote, Skeleton } from "@/components/ui";
import {
  ContractNotConfiguredError,
  fetchGoalId,
  fetchParticipant,
  fetchParticipants,
  fetchPool,
  fetchPools,
  fetchProofTier,
} from "@/lib/contract";
import { challengeShareUrl } from "@/lib/challenges";
import { fetchWithWalletAuth, type WalletAuthRequester } from "@/lib/client-auth";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { useDisplayNames } from "@/lib/use-display-names";

/** The on-chain initiative string every challenge pool carries. Mirrors
 *  CHALLENGE_INITIATIVE in CreateChallenge.tsx, which writes it at createPool. */
const CHALLENGE_INITIATIVE = "challenge";

/** The invite row the signed route returns, before the on-chain pool read. */
interface RawInvite {
  poolId: string;
  inviteToken: string;
  challengerAddress: string;
  message: string | null;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Accepter count for a pool, or null on a read miss (the card still renders,
 *  it just states no reward figure). */
function participantCountOf(poolId: bigint): Promise<number | null> {
  return fetchParticipants(poolId)
    .then((list) => list.length)
    .catch(() => null);
}

/**
 * Both sides of the peer-challenge layer for one wallet, read entirely from
 * the chain. fetchPools() is the poolCount-enumeration path the dashboard uses;
 * getParticipant and getParticipants are view calls. No getLogs anywhere.
 */
async function fetchMyChallenges(
  address: `0x${string}`,
): Promise<MyChallenges> {
  const pools = await fetchPools();
  const challengePools = pools.filter(
    (pool) => pool.initiative === CHALLENGE_INITIATIVE,
  );

  // One getParticipant eth_call per challenge pool - the exact reliable read
  // DashboardContent.fetchJoinedPools uses, scoped here to challenge pools.
  const participants = await Promise.all(
    challengePools.map((pool) => fetchParticipant(pool.id, address)),
  );

  // Aimed at you: a challenge you joined that somebody else created. Excluding
  // your own pools keeps "@creator challenged you" honest and keeps a pool from
  // showing in both sections at once.
  const joinedChallenges = challengePools
    .map((pool, i) => ({ pool, participant: participants[i] }))
    .filter(
      (entry) =>
        entry.participant.joined && !sameAddress(entry.pool.creator, address),
    );

  // Resolve the on-chain trust tier for challenges whose result is recorded and
  // passing but not yet settled - the only state whose badge could otherwise
  // over-claim "Verified". A read miss leaves the tier "unknown" (never
  // verified). Every other challenge needs no tier and carries null.
  const inChallenges: InChallenge[] = await Promise.all(
    joinedChallenges.map(async (entry): Promise<InChallenge> => {
      const participantCount = await participantCountOf(entry.pool.id);
      const p = entry.participant;
      if (!(p.resultRecorded && p.verdict && !entry.pool.settled)) {
        return { ...entry, participantCount, tier: null };
      }
      try {
        const goalId = await fetchGoalId(entry.pool.id, address);
        return { ...entry, participantCount, tier: await fetchProofTier(goalId) };
      } catch {
        return { ...entry, participantCount, tier: "unknown" };
      }
    }),
  );

  // Sent by you: any challenge pool you created. Carry your own participation
  // (from the participants read above) so a commitment you staked on yourself is
  // told apart from a reward you funded for a friend - both are bountyModel-2
  // pools, so the creator staking is the only on-chain signal that separates them.
  const selfJoined = new Map(
    challengePools.map((pool, i) => [pool.id, participants[i].joined]),
  );
  const sentPools = challengePools.filter((pool) =>
    sameAddress(pool.creator, address),
  );

  // Accepter count per sent challenge (getParticipants view call - reliable, no
  // logs). A read miss leaves the count null rather than dropping the card.
  const counts = await Promise.all(
    sentPools.map((pool) => participantCountOf(pool.id)),
  );
  const sentChallenges: SentChallenge[] = sentPools.map((pool, i) => ({
    pool,
    participantCount: counts[i],
    selfStaked: selfJoined.get(pool.id) === true,
  }));

  return { inChallenges, sentChallenges };
}

/**
 * The dares aimed at your handle that you have not yet accepted.
 *
 * The invite list itself is signature-gated (only the handle's owner may read
 * its tokens), so this asks /api/challenges/invited with the wallet proof
 * attached. Everything after that is the page's usual reliable read: one
 * fetchPool per invite for the goal / reward / window, one fetchParticipant to
 * drop anything already joined (that belongs in "Challenges you're in"). No
 * getLogs. Best-effort by design: an unsigned or failed response yields an empty
 * list so the additive section simply stays hidden rather than erroring the page.
 */
async function fetchInvitedChallenges(
  address: `0x${string}`,
  requestAuth: WalletAuthRequester,
): Promise<InvitedChallenge[]> {
  const { response, auth } = await fetchWithWalletAuth(
    "/api/challenges/invited",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    },
    requestAuth,
  );
  // The tokens are private to the handle owner: without an attached signature
  // there is nothing to show, and a non-ok response is not worth erroring over.
  if (auth.kind !== "ok" || !response.ok) return [];

  const body = (await response.json().catch(() => ({}))) as {
    invites?: RawInvite[];
  };
  const raw = body.invites ?? [];

  const resolved = await Promise.all(
    raw.map(async (invite): Promise<InvitedChallenge | null> => {
      let poolId: bigint;
      try {
        poolId = BigInt(invite.poolId);
      } catch {
        return null;
      }
      try {
        const pool = await fetchPool(poolId);
        const participant = await fetchParticipant(poolId, address);
        // Already accepted -> it lives in "Challenges you're in", not here.
        if (participant.joined) return null;
        return {
          pool,
          participantCount: await participantCountOf(poolId),
          inviteToken: invite.inviteToken,
          challengerAddress: invite.challengerAddress,
          message: invite.message,
        };
      } catch {
        // An unreadable pool is dropped rather than shown as a broken card.
        return null;
      }
    }),
  );

  return resolved.filter((entry): entry is InvitedChallenge => entry !== null);
}

/** Whether a new challenge can start on this build. Every challenge is a
 *  wearable run, so the document checker never gates it; the one thing that
 *  can is a verified win that could not pay (the same approval probe
 *  /challenge/new decides on, lib/game/join-checks). Read-only: the create
 *  page checks again before any money moves. Checking or a failed probe keeps
 *  the normal action. */
function useChallengePause(): { detail: string } | null {
  const approval = useApprovalProbe();
  const block = challengeCreateBlock("available", payoutStateOf(approval.mode));
  return block.kind === "paused" ? { detail: block.detail } : null;
}

function MyChallengesContent() {
  const { ready, authenticated, address } = useEmbeddedWallet();
  const requestAuth = useWalletAuth();

  const query = useQuery({
    queryKey: ["my-challenges", address],
    queryFn: () => {
      if (address === null) throw new Error("No wallet address.");
      return fetchMyChallenges(address);
    },
    enabled: address !== null,
  });

  // The dares aimed at your handle. Signature-gated, so it is cached on the
  // address: the embedded wallet signs once and the credential is reused rather
  // than re-signing every render.
  const invitedQuery = useQuery({
    queryKey: ["invited-challenges", address],
    queryFn: () => {
      if (address === null) throw new Error("No wallet address.");
      return fetchInvitedChallenges(address, requestAuth);
    },
    enabled: address !== null,
  });

  // Resolve challengers to @handles for the "in" and "invited" cards. A stable,
  // deduped array keeps the resolver's query key from churning on every render;
  // useDisplayNames normalizes and dedupes the two sources internally.
  const nameAddresses = useMemo(
    () => [
      ...(query.data?.inChallenges ?? []).map((entry) => entry.pool.creator),
      ...(invitedQuery.data ?? []).map((entry) => entry.challengerAddress),
    ],
    [query.data, invitedQuery.data],
  );
  const { displayName } = useDisplayNames(nameAddresses);
  const pause = useChallengePause();

  const origin =
    typeof window === "undefined" ? "" : window.location.origin;

  if (!ready) {
    return (
      <Frame
        pose="detective"
        first={
          <SignInLoadingCard label="Loading your challenges">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-5 h-11 w-44" />
          </SignInLoadingCard>
        }
      />
    );
  }

  if (!authenticated || address === null) {
    // Email-first panel, the same signed-out path the dashboard uses: we make
    // the wallet, an external wallet is the deliberate second choice inside it.
    return (
      <Frame
        pose="wave"
        lead="Sign in to see the challenges aimed at you and the ones you sent. Base Sepolia test USDC."
        first={<SignInPanel surface="card" />}
      />
    );
  }

  if (query.isLoading || (query.isSuccess && invitedLoadingOnEmpty(query.data, invitedQuery.isLoading))) {
    return (
      <Frame
        pose="detective"
        first={
          <Card aria-busy="true">
            <p className="sr-only" role="status">
              Reading your challenges from Base Sepolia
            </p>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-5 h-11 w-44" />
          </Card>
        }
      />
    );
  }

  if (query.isError) {
    return (
      <Frame
        pose="thinking"
        first={
          <Card>
            <ErrorNote
              title="Could not load your challenges"
              detail="I could not read your challenges from Base Sepolia. Nothing changed. Try again."
              raw={
                query.error instanceof Error &&
                !(query.error instanceof ContractNotConfiguredError)
                  ? query.error.message
                  : undefined
              }
              retryLabel="Read my challenges again"
              onRetry={() => {
                void query.refetch();
              }}
            />
          </Card>
        }
      />
    );
  }

  const data = query.data ?? { inChallenges: [], sentChallenges: [] };
  const invited = invitedQuery.data ?? [];
  const nothing =
    data.inChallenges.length === 0 &&
    data.sentChallenges.length === 0 &&
    invited.length === 0;

  if (nothing) {
    return pause !== null ? (
      <Frame
        pose="thinking"
        first={
          <EmptyCard
            title={PAUSED_TITLE}
            detail={pause.detail}
            action={<StartAction paused />}
          />
        }
      />
    ) : (
      <Frame
        pose="meditate"
        first={
          <EmptyCard
            title="No challenges yet"
            detail="Put money on yourself and challenge a friend to match your stake. Your wearable decides. When someone challenges you, it shows up here too."
            action={<StartAction paused={false} />}
          />
        }
      />
    );
  }

  return (
    <Frame pose={pause !== null ? "thinking" : "wave"} first={<StartCard pause={pause} />}>
      {invited.length > 0 ? (
        <section className="[&>*+*]:mt-4">
          <SectionHead
            title="Invited to you"
            lead="Challenges aimed at your name. Accept one by putting up the stake it asks for. Hit the goal and your stake comes back, plus your share of any missed stakes and anything added to the pot."
          />
          {invited.map((entry) => (
            <InvitedChallengeCard
              key={entry.inviteToken}
              entry={entry}
              challengerName={displayName(entry.challengerAddress)}
              acceptUrl={challengeShareUrl(origin, entry.inviteToken)}
            />
          ))}
        </section>
      ) : null}

      <section className="[&>*+*]:mt-4">
        <SectionHead
          title="Challenges you're in"
          lead="Challenges a friend sent you that you accepted. Your wearable decides: hit the goal and your stake comes back, plus your share of any missed stakes and anything added to the pot."
        />
        {data.inChallenges.length === 0 ? (
          <EmptyCard
            title="None aimed at you yet"
            detail="When a friend challenges you and you open their link to accept, it shows up here."
          />
        ) : (
          data.inChallenges.map((entry) => (
            <InChallengeCard
              key={entry.pool.id.toString()}
              entry={entry}
              challengerName={displayName(entry.pool.creator)}
            />
          ))
        )}
      </section>

      <section className="[&>*+*]:mt-4">
        <SectionHead
          title="Challenges you started"
          lead="Whoever hits gets their stake back plus an equal share of any missed stakes and anything added to the pot. If nobody hits, every stake goes back to its player and anything added comes back to you."
        />
        {data.sentChallenges.length === 0 ? (
          <EmptyCard
            title="You have not started one yet"
            detail="Put money on yourself, then send the link so a friend can match your stake."
          />
        ) : (
          data.sentChallenges.map((entry) => (
            <SentChallengeCard key={entry.pool.id.toString()} entry={entry} />
          ))
        )}
      </section>
    </Frame>
  );
}

/** A freshly invited player has no sent or joined challenges, so the empty
 *  state waits for the (signature-gated) invited read to settle; otherwise the
 *  page flashes "No challenges yet" and then pops an invite in above it. */
function invitedLoadingOnEmpty(data: MyChallenges | undefined, invitedLoading: boolean): boolean {
  if (data === undefined) return false;
  return invitedLoading && data.inChallenges.length === 0 && data.sentChallenges.length === 0;
}

export default function ChallengesPage() {
  if (DYNAMIC_CONFIGURED) return <MyChallengesContent />;
  return (
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
  );
}
