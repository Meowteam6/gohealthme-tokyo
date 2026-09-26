"use client";

// The landing's one call to action. Signed out it starts character creation;
// signed in it goes straight to the lobby. One button, never two sign-in flows
// competing for the same tap.

import Link from "next/link";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { useEmbeddedWallet } from "@/lib/wallet";

const PRIMARY =
  "inline-flex min-h-14 items-center justify-center rounded-lg bg-accent px-7 font-display text-2xl font-extrabold text-foreground shadow-[var(--shadow-pop)] hover:bg-accent-hover active:translate-y-[3px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2";

export default function LandingCta() {
  const { ready, authenticated } = useEmbeddedWallet();
  const signedIn = DYNAMIC_CONFIGURED && ready && authenticated;
  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      <Link href={signedIn ? "/pools" : "/character?next=%2Fpools"} className={PRIMARY}>
        {signedIn ? "Go to the lobby" : "Make your player"}
      </Link>
      <Link
        href="/pools"
        className="inline-flex min-h-11 items-center font-semibold text-foreground underline underline-offset-4 hover:text-accent-deep"
      >
        See the open runs first
      </Link>
    </div>
  );
}
