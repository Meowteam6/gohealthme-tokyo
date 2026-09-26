import type { ReactNode } from "react";
import { Money } from "@/components/ui";
import { commitmentRange } from "@/lib/commitment";
import { formatUsdc } from "@/lib/contract";

// The commitment model, said the same way on every screen that asks for a
// stake (HealthPoolsV3 bountyModel 2). Every number comes from lib/commitment,
// never from arithmetic here. It always leads with the player's own stake
// back: the outcome depends on their own wearable-verified effort, never on
// chance, and there is no prize language. Server-safe.
//
// No SPOTTER here: these lists sit on screens that already have their one
// pose (docs/DESIGN.md, one pose per viewport). The landing's version is
// components/landing/HowItPays.tsx, fed the same lib/commitment figures.

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
    <span className="block text-sm leading-[1.45] text-muted">
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
 * The terms before someone accepts a stake (the run page, the challenge
 * page): the facts, plain, each outcome named first so the list scans.
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
  const rows: readonly { term: string; body: ReactNode }[] = [
    {
      term: "Everyone",
      body: (
        <>
          puts in the same stake, <Money usd={stake} size="sm" />. Your result
          depends only on your own effort, verified by your wearable.
        </>
      ),
    },
    {
      term: "You hit",
      body: (
        <>
          your stake back plus an equal share of the missed stakes and any
          sponsor pot, up to <Money usd={formatUsdc(range.ifOnlyYou)} size="sm" /> right
          now.
        </>
      ),
    },
    {
      term: "You miss",
      body: "your stake goes to the players who hit. If your wearable sends nothing for the run, that is not a miss, and your stake comes back.",
    },
    { term: "Nobody hits", body: "everyone gets their stake back." },
  ];
  return (
    <div>
      <dl className="m-0 grid gap-2.5">
        {rows.map((row) => (
          <div key={row.term} className="text-[0.9375rem] leading-normal text-muted">
            <dt className="inline font-semibold text-foreground">{row.term}: </dt>
            <dd className="m-0 inline">{row.body}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 mt-3 text-[0.8125rem] text-haze">Base Sepolia test USDC, beta.</p>
    </div>
  );
}
