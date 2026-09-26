// The landing's one call to action, inside the featured run's card. It always
// goes to the run itself: signed out, the run page is a read-only preview with
// its terms and a sign-in; signed in, character creation runs there first if
// the player has not finished it, and the stake comes after. A player already
// in the run is taken back to it instead. Server-safe.

import Link from "next/link";
import { stakeWords } from "@/lib/game/landing";
import { buttonClasses } from "@/components/ui";

export default function LandingCta({
  poolId,
  entryFee,
  joined = false,
}: {
  poolId: bigint;
  entryFee: bigint;
  /** The signed-in player is already in this run. */
  joined?: boolean;
}) {
  return (
    <Link
      href={`/pools/${poolId.toString()}`}
      className={buttonClasses({ block: true, variant: joined ? "secondary" : "primary" })}
    >
      {joined ? "Open my run" : `Put ${stakeWords(entryFee)} USDC on myself`}
    </Link>
  );
}
