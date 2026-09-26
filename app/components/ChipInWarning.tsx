// The one warning above every chip-in (docs/MONEY-FLOWS.md F5): where added
// money goes on this run's bounty model, who gets it if nobody hits, and that
// it is not refunded to whoever added it. FundPool renders it right above the
// amount, so no chip-in path (challenge or public run) reaches the button
// without it. Wording lives in lib/game/money-sharing.ts. Server-safe.

import { Notice } from "@/components/night/kit";
import { chipInWarningOf, type ChipInParty } from "@/lib/game/money-sharing";

export interface ChipInTerms {
  /** pool.bountyModel read from chain. */
  bountyModel: number;
  /** The pool's creator: the sponsor, the challenger, or the person backed. */
  creator: ChipInParty;
  /** The creator is staked on their own run (stake on yourself). */
  selfStake: boolean;
  /** Stakers in the run, or null when the count did not read. */
  stakers: number | null;
}

export default function ChipInWarning(props: ChipInTerms) {
  const { title, lines } = chipInWarningOf(props);
  return (
    <Notice tone="limit" title={title}>
      <ul className="m-0 list-none p-0 [&>*+*]:mt-1">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </Notice>
  );
}
