// The /c/[token] page's views (docs/DESIGN.md, Night Shift): the challenged
// player's intro above the lobby, the backer view, the pause card and the dead
// link. The page (app/c/[token]) owns every read and decision; these only draw
// what it read, so the dev gallery can render each state from fixtures.
// Server-safe: no hooks (the share and chip-in children are client islands).

import Link from "next/link";
import type { ReactNode } from "react";
import ChallengeContribute from "@/components/ChallengeContribute";
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
import type { DarePot } from "@/lib/challenges";
import { commitmentRange } from "@/lib/commitment";
import { commitmentFacts } from "@/lib/game/commitment-copy";

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

/** The backer's money line. pool.balance counts every player's own stake, so
 *  the pot is stated net of stakes and the challenger's seed is split from
 *  friends' top-ups. No figure at all when it cannot be stated honestly
 *  (settled, cancelled, or a read missed). */
function PotLine({ pot }: { pot: DarePot }) {
  if (pot.prize === null) return null;
  const fromFriends =
    pot.seed !== null && pot.prize > pot.seed ? pot.prize - pot.seed : 0n;
  return (
    <p className="num m-0 mt-3 max-w-[60ch] text-[1.0625rem] leading-[1.5] text-muted">
      In the pot: <b className="font-semibold text-gold">{formatUsdc(pot.prize)} USDC</b>
      {fromFriends > 0n ? ` (${formatUsdc(fromFriends)} of it from backers)` : ""}, shared
      by the players who hit the goal on top of their own stake back.
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
            See the open runs
          </Link>
        </Card>
      </PerchedHeader>
    </div>
  );
}

/** Rally more friends: the backer link, which never signs anyone up. */
export function RallyCard({ token }: { token: string }) {
  return (
    <Card as="section" aria-labelledby="rally" className="[&>*+*]:mt-4">
      <div>
        <h2 id="rally" className={CARD_TITLE}>
          Rally your friends
        </h2>
        <p className="m-0 mt-1.5 text-[0.9375rem] leading-[1.5] text-muted">
          This link opens as a backer page: friends can chip in to grow the pot, and
          it never signs them up for the challenge.
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
    </Card>
  );
}

/** "Hit it: ..." -> the lead bolded, the rest plain, as on the run page. */
function Fact({ icon, text, extra }: { icon: ReactNode; text: string; extra?: ReactNode }) {
  const cut = text.indexOf(": ");
  const lead = cut > 0 ? text.slice(0, cut + 1) : "";
  const rest = cut > 0 ? text.slice(cut + 2) : text;
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-0.5 flex size-5 flex-none items-center justify-center text-muted">
        {icon}
      </span>
      <span className="text-[0.9375rem] leading-[1.5] text-muted">
        {lead !== "" ? <b className="font-semibold text-foreground">{lead}</b> : null} {rest}
        {extra}
      </span>
    </li>
  );
}

const ICON = {
  width: 18,
  height: 18,
  viewBox: "0 0 18 18",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/**
 * The commitment terms before someone accepts (docs/DESIGN.md, the commitment
 * model): the same stake, then hit, miss and nobody hits, in the run page's
 * icon-list form. Wording from commitmentFacts, which follows whether this
 * run can record a miss (lib/miss-rule.ts), the one number from
 * commitmentRange; no arithmetic here. SPOTTER stands on this card, so the list
 * carries no otter of its own.
 */
function ChallengeTermsList({ terms }: { terms: ChallengeTerms }) {
  const range = commitmentRange({
    entryFee: terms.entryFee,
    players: terms.players,
    sponsorPot: terms.sponsorPot,
    includeJoiner: true,
    recordsMisses: terms.recordsMisses,
  });
  const facts = commitmentFacts(terms.recordsMisses);
  return (
    <div>
      <p className="num m-0 text-[0.9375rem] text-muted">
        Everyone puts in the same stake:{" "}
        <b className="font-semibold text-gold">{formatUsdc(terms.entryFee)} USDC</b>.{" "}
        {facts.effort}
      </p>
      <ul className="num m-0 mt-3 list-none [&>*+*]:mt-2.5 p-0">
        <Fact
          icon={
            <svg {...ICON}>
              <circle cx="9" cy="9" r="7.2" />
              <path d="M5.8 9.2 8 11.3l4.2-4.5" />
            </svg>
          }
          text={facts.hit}
          extra={
            <>
              {" "}Up to <b className="font-semibold text-gold">{formatUsdc(range.ifOnlyYou)}</b> right now.
            </>
          }
        />
        <Fact
          icon={
            <svg {...ICON}>
              <circle cx="9" cy="9" r="7.2" />
              <path d="M5.8 9h6.4" />
            </svg>
          }
          text={facts.miss}
        />
        <Fact
          icon={
            <svg {...ICON}>
              <path d="M6.5 5 3.5 8l3 3" />
              <path d="M3.8 8h7.2a3.5 3.5 0 0 1 0 7H9" />
            </svg>
          }
          text={facts.nobody}
        />
      </ul>
    </div>
  );
}

export interface ChallengeTerms {
  entryFee: bigint;
  players: number;
  sponsorPot: bigint;
  /** Whether SPOTTER can record a miss on this run (lib/miss-rule.ts). */
  recordsMisses: boolean;
}

/**
 * The challenged player's intro above the lobby: who put money on them, their
 * words, and the terms before the accept, with SPOTTER on the terms card.
 */
export function ChallengeIntro({
  challengerName,
  seed,
  targetHandle,
  message,
  terms,
  backers,
}: {
  challengerName: string;
  /** The challenger's seed, when it can be stated. */
  seed: bigint | null;
  targetHandle: string | null;
  message: string | null;
  /** Null when a read missed or the run cannot take stakes: no invented terms. */
  terms: ChallengeTerms | null;
  backers: string[];
}) {
  const headline: ReactNode =
    seed !== null && seed > 0n ? (
      <>
        {challengerName} put <HeadlineMoney usd={formatUsdc(seed)} /> on you
      </>
    ) : (
      `${challengerName} challenged you`
    );
  return (
    <PerchedHeader
      above={<Tag>You have been challenged</Tag>}
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
        {terms !== null ? <ChallengeTermsList terms={terms} /> : null}
        <BackedBy names={backers} />
        <SpotterCaption line="Accept and your stake goes in. I read your wearable; only the yes or no result goes on chain, never your data." />
        <p className="m-0 text-[0.8125rem] leading-[1.45] text-haze">Test USDC during beta.</p>
      </Card>
    </PerchedHeader>
  );
}

/** Challenges that cannot be checked or paid on this build take no money. */
export function ChallengePausedCard({ reason }: { reason: "checker" | "payouts" }) {
  return (
    <Card>
      <Notice
        tone="limit"
        role="status"
        title="Chipping in is paused too"
        action={
          <Link href="/pools" className={PRIMARY_LINK}>
            {reason === "checker" ? "Find a wearable run" : "See the open runs"}
          </Link>
        }
      >
        No money is taken for a challenge that cannot be{" "}
        {reason === "checker" ? "checked" : "paid out"} right now. Nothing has been
        charged.
        {reason === "checker" ? " Wearable runs in the lobby still work." : ""}
      </Notice>
    </Card>
  );
}

/**
 * The rally link's page: leads with chipping in and never offers accept, so a
 * friend who came to help is never staked into the challenge as a player.
 */
export function BackerView({
  token,
  poolId,
  challengerName,
  target,
  message,
  pot,
  backers,
  canGrow,
}: {
  token: string;
  poolId: bigint;
  challengerName: string;
  /** "@handle" or "their friend". */
  target: string;
  message: string | null;
  pot: DarePot;
  backers: string[];
  /** Live, can pay, and checkable and payable on this build. */
  canGrow: boolean;
}) {
  return (
    <div className={`${PAGE_COLUMN} [&>*+*]:mt-6`}>
      <PerchedHeader
        above={<Tag>Back the challenge</Tag>}
        title={`${challengerName} challenged ${target}`}
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
          />
        ) : (
          <EmptyCard
            title="This challenge is not taking backers anymore"
            detail="Its window has closed, it has already paid out, or it cannot be checked or paid on this build, so nothing can be added. Nothing was charged."
            action={
              <Link href="/pools" className={PRIMARY_LINK}>
                See the open runs
              </Link>
            }
          />
        )}
      </PerchedHeader>
      {canGrow ? <RallyCard token={token} /> : null}
      <p className="m-0 text-[0.9375rem] text-muted">
        Are you the one who got challenged?{" "}
        <Link
          href={`/c/${token}`}
          className="font-semibold text-foreground underline decoration-muted/40 underline-offset-4"
        >
          Open the challenge to accept it
        </Link>
      </p>
    </div>
  );
}
