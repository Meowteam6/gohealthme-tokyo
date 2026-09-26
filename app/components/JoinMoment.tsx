// The stake card once the stake is in (docs/DESIGN.md, "Stake card states",
// joined): the numbers relabelled "You put in", "You're in. Goodnight.", what
// happens next in plain words, the public receipt, a calendar entry for the
// close, and the one action left: bring a friend. Calm on purpose: a join
// proves nothing and pays nothing, so there is no gold beyond the pot and no
// celebration (that is the verdict's job).
//
// What happens next is said as the product works: the player syncs the
// wearable and sends SPOTTER in to check; the contract pays after the close.
// A fresh join in this mount announces itself; a returning player gets the
// same card silently.

import type { ReactNode } from "react";
import { StakeStats, StakeVault } from "@/components/run/StakeCard";
import { Glyph } from "@/components/run/glyphs";
import { baseTxUrl } from "@/lib/chains";
import { TEXT_LINK } from "@/components/ui";

export interface JoinMomentProps {
  txHash: string | null;
  /** True right after a join landed in this mount: the card is announced. */
  fresh?: boolean;
  stake: string;
  pot: string;
  players: number | null;
  /** A sleep run says goodnight; any other run just says you are in. */
  night?: boolean;
  /** "WHOOP", or "wearable" when none is known. */
  deviceName?: string;
  /** "7 hours", "the goal". */
  goalShort?: string;
  /** "08:30 on Sunday". */
  closeLabel?: string;
  /** A data: URL for the close's calendar event; null before the clock reads. */
  icsHref?: string | null;
  /** "08:30", for the calendar link's words. */
  closeClock?: string;
  /** Usually the challenge button; null for a private challenge. */
  action?: ReactNode;
}

export default function JoinMoment({
  txHash,
  fresh = true,
  stake,
  pot,
  players,
  night = true,
  deviceName = "wearable",
  goalShort = "the goal",
  closeLabel,
  icsHref = null,
  closeClock,
  action,
}: JoinMomentProps) {
  const app = deviceName === "wearable" ? "your wearable's app" : `the ${deviceName} app`;
  return (
    <div role={fresh ? "status" : undefined}>
      <StakeStats joined stake={stake} pot={pot} players={players} className="mb-4 border-b border-edge pb-3.5" />
      <h3 className="type-heading m-0 text-[1.75rem]">{night ? "You're in. Goodnight." : "You're in."}</h3>
      <p className="num m-0 mt-2 text-base text-muted">
        When you wake, open {app} so the {night ? "night" : "day"} syncs, then have SPOTTER check it here.
        Hit {goalShort} and the contract pays after the run closes
        {closeLabel !== undefined ? ` at ${closeLabel}` : ""}.
      </p>
      <div className="mt-1.5 flex flex-col items-start">
        {txHash !== null ? (
          <a href={baseTxUrl(txHash)} target="_blank" rel="noopener noreferrer" className={`${TEXT_LINK} text-[0.9375rem]`}>
            See the stake on Basescan
            <Glyph name="out" />
          </a>
        ) : null}
        {icsHref !== null ? (
          <a href={icsHref} download="gohealthme-run-close.ics" className={`${TEXT_LINK} text-[0.9375rem]`}>
            Add the {closeClock ?? "close"} close to my calendar
          </a>
        ) : null}
      </div>
      {action !== undefined && action !== null ? <div id="stake-done-action" className="mt-2.5">{action}</div> : null}
      <StakeVault />
    </div>
  );
}
