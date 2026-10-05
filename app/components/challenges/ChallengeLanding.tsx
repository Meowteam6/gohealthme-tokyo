// The /c/[token] page's views (docs/DESIGN.md, Night Shift): the challenged
// player's intro above the lobby, the backer view, the pause card and the dead
// link. The page (app/c/[token]) owns every read and decision; these only draw
// what it read, so the dev gallery can render each state from fixtures.
// Server-safe: no hooks (the share and chip-in children are client islands).

import Link from "next/link";
import type { ReactNode } from "react";
import ChallengeContribute from "@/components/ChallengeContribute";
import type { ChipInTerms } from "@/components/ChipInWarning";
import ShareChallenge from "@/components/ShareChallenge";
import SpotterCaption from "@/components/spotter/SpotterCaption";
import {
  CARD_TITLE,
  EmptyCard,
  Notice,
  PAGE_COLUMN,
  PerchedHeader,
} from "@/components/night/kit";
import { Card, Tag, buttonClasses } from "@/components/ui";
import { formatUsdc } from "@/lib/contract";
import type { ChallengePauseReason, DarePot } from "@/lib/challenges";
import { addToPotPausedDetail } from "@/lib/switches";
import { MoneyChips, MoneyTermsList } from "@/components/game/MoneyTerms";
import { runMoneyOf } from "@/lib/game/money-flow";
import {
  challengeLandingHeadOf,
  rallyCopyOf,
  type ChallengeRunKind,
} from "@/lib/game/money-sharing";

const PRIMARY_LINK = buttonClasses({ size: "sm" });

/** A figure inside a Fraunces headline: numbers set in Figtree, money in gold. */
function HeadlineMoney({ usd }: { usd: string }) {
  return (
    <span className="num whitespace-nowrap font-sans font-semibold tracking-[-0.02em] text-gold">
      {usd} <span className="text-[0.6em] font-medium tracking-normal text-haze">USDC</span>
    </span>
  );
}

/** The challenger's own words, quoted under the headline. */
function Quote({ children }: { children: string }) {
  return (
    <blockquote className="m-0 mt-4 border-l-2 border-moonlight/60 pl-4 text-[1.0625rem] leading-[1.5] text-foreground">
      {children}
    </blockquote>
  );
}

/** "Backed by a, b, c and 2 more": the friends who chipped in after creation. */
export function BackedBy({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <p className="m-0 text-[0.9375rem] text-muted">
      Backed by{" "}
      <span className="font-semibold text-foreground">{names.slice(0, 3).join(", ")}</span>
      {names.length > 3 ? ` and ${names.length - 3} more` : ""}
    </p>
  );
}

/** The backer's money line: the one Pot figure (every stake plus the extra,
 *  which is pool.balance while live), then its parts in words, with the
 *  backers' share of the extra split from the challenger's own. No figure at
 *  all when it cannot be stated honestly (settled, cancelled, or a read
 *  missed). */
function PotLine({ pot }: { pot: DarePot }) {
  if (pot.prize === null || pot.stakes === null) return null;
  const fromFriends =
    pot.seed !== null && pot.prize > pot.seed ? pot.prize - pot.seed : 0n;
  return (
    <p className="num m-0 mt-3 max-w-[60ch] text-[1.0625rem] leading-[1.5] text-muted">
      Pot <b className="font-semibold text-gold">{formatUsdc(pot.stakes + pot.prize)} USDC</b>:{" "}
      {formatUsdc(pot.stakes)} in stakes, plus {formatUsdc(pot.prize)} extra
      {fromFriends > 0n ? ` (${formatUsdc(fromFriends)} of it from backers)` : ""}. The extra is
      split among the players who hit the goal, on top of their own stake back.
    </p>
  );
}

/** A bad or vanished link, with no leak of whether any other token exists. */
export function ChallengeInvalid() {
  return (
    <div className={PAGE_COLUMN}>
      <PerchedHeader
        title="This challenge link does not open"
        lead="It may have been mistyped, or the challenge no longer exists. Ask whoever sent it for a fresh link."
        pose="thinking"
      >
        <Card>
          <SpotterCaption line="This link goes nowhere. I checked twice." />
          <Link href="/pools" className={`mt-4 ${PRIMARY_LINK}`}>
            See the open challenges
          </Link>
        </Card>
      </PerchedHeader>
    </div>
  );
}

/** Rally more friends: the backer link, which never signs anyone up. */
export function RallyCard({
  token,
  name,
}: {
  token: string;
  /** The challenger, as displayNameFor shows them. */
  name: string;
}) {
  const copy = rallyCopyOf(name);
  return (
    <Card as="section" aria-labelledby="rally" className="[&>*+*]:mt-4">
      <div>
        <h2 id="rally" className={CARD_TITLE}>
          {copy.heading}
        </h2>
        <p className="m-0 mt-1.5 text-[0.9375rem] leading-[1.5] text-muted">{copy.detail}</p>
      </div>
      <ShareChallenge
        token={token}
        backer
        title={copy.title}
        message={copy.message}
        emailSubject={copy.emailSubject}
        shareLabel={copy.shareLabel}
      />
    </Card>
  );
}

/**
 * The terms before someone accepts (docs/MONEY-FLOWS.md, section 3): the kind
 * and miss chips, the flow's line and its terms. A match-the-stake challenge
 * reads as the equal-stakes table; an older challenge with a reward names the
 * lock-in, the reward and what the challenger takes back. The flow is the page's one decision (`kind`,
 * challengeRunKindOf), so the chips can never disagree with the headline.
 * Wording from lib/game/money-flow.ts, numbers from lib/commitment.ts; no
 * arithmetic here. SPOTTER stands on this card, so the list carries no otter
 * of its own. Dates stay out: this renders on the server, whose clock zone is
 * not the reader's.
 */
function ChallengeTermsList({
  terms,
  kind,
  challengerName,
}: {
  terms: ChallengeTerms;
  kind: ChallengeRunKind;
  challengerName: string;
}) {
  const money = runMoneyOf({
    pool: { bountyModel: 2, initiative: "challenge" },
    flow: {
      players: terms.players,
      creatorStaked: kind === "self",
      kind,
      creatorName: challengerName,
    },
    numbers: {
      entryFee: terms.entryFee,
      players: terms.players,
      pot: terms.sponsorPot,
      // The gallery's fixtures predate the fee read; a live page passes it.
      feeBps: terms.feeBps === undefined ? 0 : terms.feeBps,
      recordable: terms.recordsMisses,
      includeJoiner: true,
      confirmBy: null,
    },
  });
  return (
    <div className="[&>*+*]:mt-3.5">
      <MoneyChips kind={money.kind.chip} miss={money.miss} />
      {money.copy !== null ? <MoneyTermsList copy={money.copy} id="challenge-intro-terms" /> : null}
    </div>
  );
}

export interface ChallengeTerms {
  entryFee: bigint;
  /** Stakers in the run now, not counting whoever is reading. */
  players: number;
  sponsorPot: bigint;
  /** Whether SPOTTER can record a miss on this run (lib/miss-rule.ts). */
  recordsMisses: boolean;
  /** commitmentFeeBps; null when it did not read (no range is stated). */
  feeBps?: number | null;
}

/**
 * The invited player's intro above the lobby: who is asking ("Match @andre's
 * 10.00 USDC stake"), their words, the Pot with its parts, and the terms before the accept, with
 * SPOTTER on the terms card.
 */
export function ChallengeIntro({
  kind,
  challengerName,
  targetHandle,
  message,
  terms,
  backers,
  stake = null,
  potLine = null,
}: {
  /** Which flow this challenge is (lib/game/money-sharing challengeRunKindOf). */
  kind: ChallengeRunKind;
  challengerName: string;
  targetHandle: string | null;
  message: string | null;
  /** Null when a read missed or the challenge cannot take stakes: no invented terms. */
  terms: ChallengeTerms | null;
  backers: string[];
  /** The stake to match (pool.entryFee), for the headline. */
  stake?: bigint | null;
  /** The Pot with its parts in words (lib/game/money-flow potLineOf), or
   *  null when a read missed. */
  potLine?: string | null;
}) {
  const head = challengeLandingHeadOf({
    view: "accept",
    name: challengerName,
    stake: stake !== null ? formatUsdc(stake) : null,
  });
  const headline: ReactNode =
    stake !== null ? (
      <>
        Match {challengerName}&apos;s <HeadlineMoney usd={formatUsdc(stake)} /> stake
      </>
    ) : (
      head.title
    );
  return (
    <PerchedHeader
      above={<Tag>{head.tag}</Tag>}
      title={headline}
      pose="wearable"
      below={
        <>
          {targetHandle !== null ? (
            <p className="m-0 mt-3 text-[0.9375rem] text-haze">For {targetHandle}</p>
          ) : null}
          {message !== null ? <Quote>{message}</Quote> : null}
        </>
      }
    >
      <Card className="[&>*+*]:mt-4">
        {potLine !== null ? (
          <p className="num m-0 text-[0.9375rem] leading-[1.45] text-muted">{potLine}</p>
        ) : null}
        {terms !== null ? (
          <ChallengeTermsList terms={terms} kind={kind} challengerName={challengerName} />
        ) : null}
        <BackedBy names={backers} />
        <SpotterCaption
          line="Match it and your stake goes in. I read your wearable; only the yes or no result goes on chain, never your data."
        />
        <p className="m-0 text-[0.8125rem] leading-[1.45] text-haze">Test USDC during beta.</p>
      </Card>
    </PerchedHeader>
  );
}

/** Challenges that cannot be checked or paid on this build take no money,
 *  and nothing takes new money while the operator has it paused
 *  ("money-in", with their note). */
export function ChallengePausedCard({
  reason,
  note = null,
}: {
  reason: ChallengePauseReason;
  /** The operator's note for a money-in pause (KILL_REASON), or null. */
  note?: string | null;
}) {
  if (reason === "money-in") {
    // Nothing for the player to do: it clears when stakes are back on, like
    // every other "wait" lock, so no action that leads to another pause.
    return (
      <Card>
        <Notice tone="limit" role="status" title="Chipping in is paused too">
          {addToPotPausedDetail(note)}
        </Notice>
      </Card>
    );
  }
  return (
    <Card>
      <Notice
        tone="limit"
        role="status"
        title="Chipping in is paused too"
        action={
          <Link href="/pools" className={PRIMARY_LINK}>
            {reason === "checker" ? "Find a wearable challenge" : "See the open challenges"}
          </Link>
        }
      >
        No money is taken for a challenge that cannot be{" "}
        {reason === "checker" ? "checked" : "paid out"} right now. Nothing has been
        charged.
        {reason === "checker" ? " Wearable challenges in the lobby still work." : ""}
      </Notice>
    </Card>
  );
}

/**
 * The backer link's page ("Back me", or the rally link): leads with chipping
 * in and never offers accept, so a friend who came to help is never staked
 * into the run as a player. On a stake-on-yourself run it is "Back {name}",
 * never "challenged their friend".
 */
export function BackerView({
  token,
  poolId,
  challengerName,
  message,
  pot,
  backers,
  canGrow,
  pause = null,
  chipIn,
}: {
  token: string;
  poolId: bigint;
  challengerName: string;
  message: string | null;
  pot: DarePot;
  backers: string[];
  /** Live, can pay, and checkable and payable on this build. */
  canGrow: boolean;
  /** Why a live challenge takes no backers right now, when that is the
   *  reason it cannot grow (said plainly instead of the closed copy). */
  pause?: { reason: ChallengePauseReason; note: string | null } | null;
  /** Who the chip-in warning names and how the run pays. */
  chipIn: ChipInTerms;
}) {
  const head = challengeLandingHeadOf({ view: "backer", name: challengerName });
  return (
    <div className={`${PAGE_COLUMN} [&>*+*]:mt-6`}>
      <PerchedHeader
        above={<Tag>{head.tag}</Tag>}
        title={head.title}
        pose={canGrow ? "thumbsup" : "meditate"}
        below={
          <>
            {message !== null ? <Quote>{message}</Quote> : null}
            <PotLine pot={pot} />
            {backers.length > 0 ? (
              <div className="mt-2">
                <BackedBy names={backers} />
              </div>
            ) : null}
          </>
        }
      >
        {canGrow ? (
          <ChallengeContribute
            poolId={poolId}
            prizeUsd={pot.prize !== null ? formatUsdc(pot.prize) : null}
            chipIn={chipIn}
          />
        ) : pause !== null && pause.reason === "money-in" ? (
          // Nothing to do but come back: no action that leads to another pause.
          <EmptyCard title="Backing is paused for now" detail={addToPotPausedDetail(pause.note)} />
        ) : (
          <EmptyCard
            title="This challenge is not taking backers anymore"
            detail="Its window has closed, it has already paid out, or it cannot be checked or paid on this build, so nothing can be added. Nothing was charged."
            action={
              <Link href="/pools" className={PRIMARY_LINK}>
                See the open challenges
              </Link>
            }
          />
        )}
      </PerchedHeader>
      {canGrow ? <RallyCard token={token} name={challengerName} /> : null}
      <p className="m-0 text-[0.9375rem] text-muted">
        Want to stake alongside them instead?{" "}
        <Link
          href={`/c/${token}`}
          className="font-semibold text-foreground underline decoration-muted/40 underline-offset-4"
        >
          Open the challenge to match the stake
        </Link>
      </p>
    </div>
  );
}
