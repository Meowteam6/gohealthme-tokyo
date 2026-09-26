import type { ReactNode } from "react";
import Spotter, { SpotterBubble } from "@/components/spotter/Spotter";
import { Money } from "@/components/ui";
import { commitmentOutcome, commitmentRange } from "@/lib/commitment";
import { formatUsdc } from "@/lib/contract";
import type { SpotterPose } from "@/lib/spotter-poses";

// The commitment model, said the same way on every screen that asks for a
// stake (HealthPoolsV3 bountyModel 2). Every number comes from lib/commitment,
// never from arithmetic here. It always leads with the player's own stake
// back: the outcome depends on their own wearable-verified effort, never on
// chance, and there is no prize language. Server-safe.

const USDC = 1_000_000n;

/** The worked example on the landing: a 1 USDC stake, four players, two hit. */
const EXAMPLE = { entryFee: USDC, players: 4, sponsorPot: 0n } as const;

interface Beat {
  pose: SpotterPose;
  title: string;
  line: string;
  body: ReactNode;
}

function exampleBeats(): Beat[] {
  const hit = commitmentOutcome({ ...EXAMPLE, achievers: 2 });
  const none = commitmentOutcome({ ...EXAMPLE, achievers: 0 });
  const stake = formatUsdc(EXAMPLE.entryFee);
  const paid = hit.kind === "paid" ? hit : null;
  const refund = none.kind === "refund-all" ? none.refundEach : EXAMPLE.entryFee;
  return [
    {
      pose: "payday",
      title: "You hit it",
      line: "Told you. Here's your coin, and then some.",
      body:
        paid !== null ? (
          <>
            Your stake back plus an equal share of the missed stakes and any
            sponsor pot. Four players stake <Money usd={stake} size="sm" /> and
            two hit: each gets <Money usd={formatUsdc(paid.perAchiever)} size="sm" />,
            which is <Money usd={formatUsdc(paid.stakeBack)} size="sm" /> back
            plus <Money usd={formatUsdc(paid.fromOthers)} size="sm" />.
          </>
        ) : (
          "Your stake back plus an equal share of the missed stakes and any sponsor pot."
        ),
    },
    {
      pose: "facepalm",
      title: "You miss it",
      line: "We both saw that night.",
      body: "Your stake goes to the players who hit. Nothing else is taken from you.",
    },
    {
      pose: "thumbsup",
      title: "Nobody hits",
      line: "Rough week for everyone. Nobody loses a coin.",
      body: (
        <>
          Everyone gets their stake back, <Money usd={formatUsdc(refund)} size="sm" /> each
          in this example.
        </>
      ),
    },
  ];
}

/** The landing's three beats, one SPOTTER pose each. */
export function CommitmentBeats() {
  const beats = exampleBeats();
  return (
    <div className="space-y-5">
      <p className="max-w-2xl text-lg text-foreground/85">
        Everyone in a run puts in the same stake. Your result depends only on
        your own effort, verified by your wearable. It is Base Sepolia test
        money while the app is in beta.
      </p>
      <ul className="grid gap-3 md:grid-cols-3">
        {beats.map((beat) => (
          <li
            key={beat.title}
            className="flex flex-col gap-3 rounded-3xl border border-edge bg-surface p-5"
          >
            <div className="flex items-end gap-2">
              <Spotter pose={beat.pose} size="xs" decorative />
              <SpotterBubble line={beat.line} tail="side" />
            </div>
            <h3 className="font-display text-xl font-bold leading-tight">{beat.title}</h3>
            <p className="text-base text-foreground/85">{beat.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One line under a stake field: what a player who hits gets back, from
 * everyone hitting (just the stake) to only them hitting (every stake plus
 * the sponsor pot). `players` counts who is already in; the stake-setter or
 * joiner is added.
 */
export function CommitmentRangeLine({
  entryFee,
  players = 0,
  sponsorPot = 0n,
}: {
  entryFee: bigint;
  players?: number;
  sponsorPot?: bigint;
}) {
  if (entryFee <= 0n) return null;
  const range = commitmentRange({ entryFee, players, sponsorPot, includeJoiner: true });
  const same = range.ifOnlyYou === range.ifEveryone;
  return (
    <span className="block text-sm text-muted">
      Hit it and you get your <Money usd={formatUsdc(entryFee)} size="sm" /> stake
      back
      {same ? (
        " plus an equal share of any missed stakes."
      ) : (
        <>
          {" "}and up to <Money usd={formatUsdc(range.ifOnlyYou)} size="sm" /> if
          you are the only one who hits.
        </>
      )}{" "}
      Miss it and your stake goes to the players who hit. Nobody hits, everyone
      gets their stake back.
    </span>
  );
}

/**
 * The terms before someone accepts a stake (the challenge page): the same
 * four facts, plain, with SPOTTER's one line on top.
 */
export function CommitmentTermsList({
  entryFee,
  players = 0,
  sponsorPot = 0n,
}: {
  entryFee: bigint;
  players?: number;
  sponsorPot?: bigint;
}) {
  const range = commitmentRange({ entryFee, players, sponsorPot, includeJoiner: true });
  const stake = formatUsdc(entryFee);
  return (
    <div className="space-y-3">
      <Spotter
        pose="payday"
        size="xs"
        line="Your coin, your effort. Nobody else's night counts for you."
        linePlacement="side"
      />
      <ul className="space-y-2 text-base">
        <li>
          Everyone puts in the same stake: <Money usd={stake} size="sm" />.
        </li>
        <li>Your result depends only on your own effort, verified by your wearable.</li>
        <li>
          Hit it: your stake back plus an equal share of the missed stakes and
          any sponsor pot, up to <Money usd={formatUsdc(range.ifOnlyYou)} size="sm" />{" "}
          right now. Miss it: your stake goes to the players who hit.
        </li>
        <li>Nobody hits: everyone gets their stake back.</li>
        <li className="text-sm text-muted">Base Sepolia test money, beta.</li>
      </ul>
    </div>
  );
}
