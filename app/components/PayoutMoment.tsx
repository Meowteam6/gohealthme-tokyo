// The payout: the one place the product puts on a show (docs/DESIGN.md,
// "Celebration only at the verdict"). SPOTTER in the payday pose on a gold
// wash, a coin flips out of the pouch once, the stamp lands, then the exact
// money sentence. Fires only on a real settled payout: paidUsd comes from the
// ledger's settle entry (the AchieverPaid delta), never from a transaction
// merely succeeding.
//
// Honest about where the money is: AchieverPaid CREDITS owed[] on a
// pull-payment contract, it does not move USDC to the wallet. So this says the
// win is settled and credited, and points at the claim (ClaimPayout) that
// pulls it in; it never says the money is already in the wallet.
//
// A self-reported payout gets the same show, because money moved, but never
// reads as confirmed: its stamp is PAID and its chip says self-reported.
//
// Motion: the coin flip is 1.2s, one shot, and only when the player allows
// motion. With reduced motion the coin rests beside SPOTTER and the screen
// reads the same. The amount itself never animates.

import { ArcTxLink, Money, Stamp } from "@/components/ui";
import Spotter from "@/components/spotter/Spotter";
import { paidBreakdown } from "@/lib/game/commitment-copy";

const COIN_FLIP_CSS = `
@keyframes ghm-coin-flip {
  0% { transform: translateY(48px) rotateY(0deg) scale(0.6); opacity: 0; }
  25% { opacity: 1; }
  70% { transform: translateY(-36px) rotateY(540deg) scale(1); }
  100% { transform: translateY(0) rotateY(720deg) scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: no-preference) {
  .ghm-coin-flip { animation: ghm-coin-flip 1200ms cubic-bezier(0.2, 0.8, 0.3, 1) both; }
}
`;

/** Gold wash behind the paid verdict. Gold here means money moved. */
const GOLD_WASH =
  "radial-gradient(circle at 50% 32%, color-mix(in srgb, var(--gold) 38%, var(--surface)) 0%, var(--surface) 64%)";

export default function PayoutMoment({
  paidUsd,
  txHash,
  selfReported = false,
  selfStaked = false,
  entryFee,
  headline,
  headlineId,
  bleed = false,
}: {
  paidUsd: string;
  txHash: string | null;
  /** The low-trust tier. When true the moment NEVER claims "verified". */
  selfReported?: boolean;
  /**
   * Self-staked commitment pool (bountyModel 2). Independent of selfReported:
   * this is the economic model, not the proof tier. When true, the payout is
   * the achiever's own stake back plus a share of the stakes left in the pot.
   */
  selfStaked?: boolean;
  /** The run's stake, so a commitment payout reads as stake back plus the
   *  rest (lib/game/commitment-copy.ts paidBreakdown). */
  entryFee?: bigint;
  /** The Verdict passes its headline so the stage reads hero, stamp,
   *  headline, money, in that order. Standalone, SPOTTER's own line leads. */
  headline?: string;
  headlineId?: string;
  /** Inside the Verdict card: the wash runs edge to edge of its padding. */
  bleed?: boolean;
}) {
  return (
    <div
      className={`overflow-hidden text-center ${
        bleed
          ? "-mx-4 px-4 pb-2 pt-4 sm:-mx-6 sm:px-6"
          : "rounded-3xl border border-edge px-4 pb-5 pt-4 sm:px-6"
      }`}
      style={{ background: GOLD_WASH }}
    >
      <style href="ghm-coin-flip" precedence="default">
        {COIN_FLIP_CSS}
      </style>
      <div className="relative mx-auto w-fit [perspective:600px]">
        <Spotter
          state="verdict-paid"
          alt="SPOTTER holding up your coin"
          line={
            selfReported
              ? "Paid on your word. Still not stamped."
              : "That happened. I saw it, I paid it."
          }
        />
        <span
          aria-hidden="true"
          className="ghm-coin-flip absolute bottom-[22%] right-0 grid h-14 w-14 place-items-center rounded-full border-[3px] border-foreground bg-gold font-display text-lg font-extrabold tabular-nums text-foreground shadow-[inset_-5px_-4px_0_rgba(127,90,0,0.3)] sm:h-16 sm:w-16"
        >
          +
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Stamp tone="gold">{selfReported ? "Paid" : "Confirmed"}</Stamp>
        {selfReported ? (
          <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-bold text-warning">
            Self-reported, not verified
          </span>
        ) : null}
      </div>

      {headline !== undefined ? (
        <h2
          id={headlineId}
          className="ghm-stamp mt-4 font-display text-[clamp(2.25rem,10vw,3.5rem)] font-extrabold leading-display tracking-display text-balance"
        >
          {headline}
        </h2>
      ) : null}

      <p className="mt-3">
        <span className="sr-only">Payout: </span>
        <span className="[&>span]:text-[clamp(2.5rem,13vw,4rem)]">
          <Money usd={paidUsd} sign="+" size="xl" />
        </span>
      </p>
      <p className="mx-auto mt-2 max-w-sm text-base text-foreground text-pretty">
        {selfStaked && entryFee !== undefined
          ? `${paidBreakdown(paidUsd, entryFee)} Credited to you on chain.`
          : selfStaked
            ? `${paidUsd} USDC is credited to you on chain: your stake back, plus a share of what the players who missed left in the pot.`
            : `${paidUsd} USDC is credited to you on chain.`}{" "}
        Claim it to pull it into your wallet.
      </p>
      {txHash !== null ? (
        <p className="mt-3">
          <ArcTxLink txHash={txHash} label="See the receipt" />
          <span className="mt-0.5 block text-xs text-muted">
            Public on Base Sepolia. Anyone can check it.
          </span>
        </p>
      ) : null}
    </div>
  );
}
