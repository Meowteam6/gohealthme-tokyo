// The payout receipt (docs/DESIGN.md, "Verdict card", paid): a paper receipt
// on the night field with SPOTTER standing on its top edge, the exact amount,
// the split, when it settled and the public transaction. It fires only on a
// real settled payout: paidUsd comes from the ledger's settle entry (the
// AchieverPaid figure), never from a transaction merely succeeding.
//
// Honest about where the money is: AchieverPaid CREDITS owed[] on a
// pull-payment contract, it does not move USDC to the wallet. So the receipt
// says paid and credited, and the claim (ClaimPayout) pulls it in; it never
// says the money is already in the wallet.
//
// A self-reported payout gets the same receipt, because money moved, but never
// reads as verified: its chip says self-reported. The amount never animates.

import { SpotterFigure } from "@/components/spotter/Spotter";
import { Glyph } from "@/components/run/glyphs";
import { baseTxUrl } from "@/lib/chains";
import { paidSplitOf } from "@/lib/game/run-page";

/** "Sun 27 Sep, 08:41", in the viewer's zone. */
function paidAtLabel(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const month = d.toLocaleDateString("en-US", { month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${weekday} ${d.getDate()} ${month}, ${time}`;
}

export default function PayoutMoment({
  paidUsd,
  txHash,
  selfReported = false,
  selfStaked = false,
  entryFee,
  payee = null,
  paidAt = null,
  spotter = true,
  tuck = false,
  headline,
  headlineId,
}: {
  paidUsd: string;
  txHash: string | null;
  /** The low-trust tier. When true the receipt NEVER claims "verified". */
  selfReported?: boolean;
  /**
   * Self-staked commitment pool (bountyModel 2). Independent of selfReported:
   * this is the economic model, not the proof tier. When true, the payout is
   * the achiever's own stake back plus a share of what was left in the pot.
   */
  selfStaked?: boolean;
  /** The run's stake, so a commitment payout splits into stake back plus the
   *  rest, the way commitmentOutcome splits it. */
  entryFee?: bigint;
  /** The ENS name or handle the payout went to. */
  payee?: string | null;
  /** When the settle landed (the ledger entry's time), ISO-8601. */
  paidAt?: string | null;
  /** SPOTTER on the receipt's edge. Off where another pose owns the view. */
  spotter?: boolean;
  /** SPOTTER stands up into the header space above (the verdict card keeps
   *  its headline clear of him), instead of the receipt reserving his height. */
  tuck?: boolean;
  /** Standalone use (the proof panels) puts its own headline above. */
  headline?: string;
  headlineId?: string;
  /** Retired: the receipt no longer bleeds to the card's edge. */
  bleed?: boolean;
}) {
  const split = selfStaked && entryFee !== undefined ? paidSplitOf(paidUsd, entryFee) : null;
  const when = paidAt !== null ? paidAtLabel(paidAt) : null;
  return (
    <div>
      {headline !== undefined ? (
        <h2
          id={headlineId}
          className={`type-heading m-0 text-[1.875rem] ${spotter ? "max-w-[calc(100%-100px)]" : ""}`}
        >
          {headline}
        </h2>
      ) : null}
      <article
        aria-label="Payout receipt"
        className={`relative rounded-[18px] bg-[linear-gradient(180deg,var(--paper-top),var(--paper))] px-[18px] pb-3 pt-4 text-ink shadow-paper ${
          spotter && !tuck && headline === undefined ? "mt-[100px]" : "mt-5"
        }`}
      >
        {spotter ? (
          <span className="pointer-events-none absolute bottom-[calc(100%-4px)] right-[18px]">
            <SpotterFigure pose="thumbsup" width={[84, 84]} alt="SPOTTER giving a thumbs up" />
          </span>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-[26px] items-center rounded-tag bg-ink px-2.5 text-[0.8125rem] font-semibold text-paper">
              Paid
            </span>
            {selfReported ? (
              <span className="inline-flex h-[26px] items-center rounded-tag px-2 text-[0.8125rem] font-semibold text-ink-2 shadow-[inset_0_0_0_1px_var(--ink-2)]">
                Self-reported, not verified
              </span>
            ) : null}
          </span>
          {payee !== null ? (
            <span className="min-w-0 truncate text-sm font-medium text-ink-2">{payee}</span>
          ) : null}
        </div>
        <p className="num m-0 mt-3 text-[2.5rem] font-bold leading-none tracking-[-0.02em]">
          <span className="sr-only">Payout: </span>
          {paidUsd}
          <small className="ml-1.5 text-[0.9375rem] font-semibold tracking-normal text-ink-2">USDC</small>
        </p>
        {split !== null ? (
          <div className="num mt-3 grid gap-1 border-t border-dashed border-ink/20 pt-2.5 text-[0.9375rem]">
            <div className="flex justify-between gap-3">
              <span className="text-ink-2">Your stake back</span>
              <span className="font-semibold">{split.stake}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-ink-2">Your share of the pot</span>
              <span className="font-semibold">{split.rest}</span>
            </div>
          </div>
        ) : null}
        <div className="num mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[0.8125rem] text-ink-2">
          <span>{when ?? "Settled on Base Sepolia"}</span>
          {txHash !== null ? (
            <a
              href={baseTxUrl(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 font-semibold text-ink underline decoration-ink/30 underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              View on Basescan
              <Glyph name="out" />
            </a>
          ) : null}
        </div>
      </article>
      <p className="m-0 mt-2.5 text-[0.8125rem] leading-[1.45] text-haze">
        The settle credited this to you on chain. Claiming pulls it into your wallet.
      </p>
    </div>
  );
}
