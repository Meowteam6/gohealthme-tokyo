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
import type { DarePot } from "@/lib/challenges";
import { commitmentRange } from "@/lib/commitment";
import { commitmentFacts } from "@/lib/game/commitment-copy";
import {
  acceptTermsOf,
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
export function RallyCard({
  token,
  kind,
  name,
}: {
  token: string;
  kind: ChallengeRunKind;
  /** The challenger, as displayNameFor shows them. */
  name: string;
}) {
  const copy = rallyCopyOf(kind, name);
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
 * model): the miss chip and the head count, the same stake, then hit, miss and
 * nobody hits, in the run page's icon-list form. Wording from acceptTermsOf,
 * which follows the flow (match a stake, or accept a reward challenge with a
 * lock-in) and whether this run can record a miss (lib/miss-rule.ts); the one
 * number from commitmentRange; no arithmetic here. SPOTTER stands on this
 * card, so the list carries no otter of its own.
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
  const range = commitmentRange({
    entryFee: terms.entryFee,
    players: terms.players,
    sponsorPot: terms.sponsorPot,
    includeJoiner: true,
    recordsMisses: terms.recordsMisses,
  });
  const facts = commitmentFacts(terms.recordsMisses);
  const lines = acceptTermsOf({
    kind,
    recordable: terms.recordsMisses,
    players: terms.players,
    challengerName,
  });
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="muted" dot={false}>
          {lines.chip}
        </Tag>
        <Tag tone="muted" dot={false}>
          {lines.count}
        </Tag>
      </div>
      <p className="num m-0 mt-3 text-[0.9375rem] text-muted">
        {lines.stakeLead}{" "}
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
          text={lines.hit}
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
          text={lines.miss}
        />
        <Fact
          icon={
            <svg {...ICON}>
              <path d="M6.5 5 3.5 8l3 3" />
              <path d="M3.8 8h7.2a3.5 3.5 0 0 1 0 7H9" />
            </svg>
          }
          text={lines.nobody}
        />
      </ul>
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
}

/**
 * The invited player's intro above the lobby: who is asking (match their
 * stake, or a reward challenge that put money on them), their words, and the
 * terms before the accept, with SPOTTER on the terms card.
 */
export function ChallengeIntro({
  kind,
  challengerName,
  seed,
  targetHandle,
  message,
  terms,
  backers,
}: {
  /** Which flow this run is (lib/game/money-sharing challengeRunKindOf). */
  kind: ChallengeRunKind;
  challengerName: string;
  /** The challenger's seed, when it can be stated. */
  seed: bigint | null;
  targetHandle: string | null;
  message: string | null;
  /** Null when a read missed or the run cannot take stakes: no invented terms. */
  terms: ChallengeTerms | null;
  backers: string[];
}) {
  const head = challengeLandingHeadOf({ kind, view: "accept", name: challengerName, target: "" });
  const headline: ReactNode =
    kind === "reward" && seed !== null && seed > 0n ? (
      <>
        {challengerName} put <HeadlineMoney usd={formatUsdc(seed)} /> on you
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
        {terms !== null ? (
          <ChallengeTermsList terms={terms} kind={kind} challengerName={challengerName} />
        ) : null}
        <BackedBy names={backers} />
        <SpotterCaption
          line={
            kind === "reward"
              ? "Accept and your lock-in goes in. I read your wearable; only the yes or no result goes on chain, never your data."
              : "Accept and your stake goes in. I read your wearable; only the yes or no result goes on chain, never your data."
          }
        />
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
 * The backer link's page ("Back me", or the rally link): leads with chipping
 * in and never offers accept, so a friend who came to help is never staked
 * into the run as a player. On a stake-on-yourself run it is "Back {name}",
 * never "challenged their friend".
 */
export function BackerView({
  kind,
  token,
  poolId,
  challengerName,
  target,
  message,
  pot,
  backers,
  canGrow,
  chipIn,
}: {
  /** Which flow this run is (lib/game/money-sharing challengeRunKindOf). */
  kind: ChallengeRunKind;
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
  /** Who the chip-in warning names and how the run pays. */
  chipIn: ChipInTerms;
}) {
  const head = challengeLandingHeadOf({ kind, view: "backer", name: challengerName, target });
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
            kind={kind}
            chipIn={chipIn}
          />
        ) : (
          <EmptyCard
            title={kind === "reward" ? "This challenge is not taking backers anymore" : "This run is not taking backers anymore"}
            detail="Its window has closed, it has already paid out, or it cannot be checked or paid on this build, so nothing can be added. Nothing was charged."
            action={
              <Link href="/pools" className={PRIMARY_LINK}>
                See the open runs
              </Link>
            }
          />
        )}
      </PerchedHeader>
      {canGrow ? <RallyCard token={token} kind={kind} name={challengerName} /> : null}
      <p className="m-0 text-[0.9375rem] text-muted">
        {kind === "reward" ? "Are you the one who got challenged? " : "Want to stake alongside them instead? "}
        <Link
          href={`/c/${token}`}
          className="font-semibold text-foreground underline decoration-muted/40 underline-offset-4"
        >
          {kind === "reward" ? "Open the challenge to accept it" : "Open the run to match the stake"}
        </Link>
      </p>
    </div>
  );
}
