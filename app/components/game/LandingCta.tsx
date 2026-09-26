"use client";

// The landing's one call to action. Signed out it starts character creation;
// signed in it goes straight to the lobby. One button, never two sign-in flows
// competing for the same tap.

import Link from "next/link";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { useEmbeddedWallet } from "@/lib/wallet";

// The Button primary look (components/ui.tsx) on a Link: coral fill, ink
// text, the pressable 4px bottom shadow. Full width on a phone.
const PRIMARY =
  "inline-flex min-h-14 w-full items-center justify-center rounded-[18px] bg-accent px-7 py-3 text-lg font-bold text-foreground shadow-[var(--shadow-pop)] transition-transform hover:bg-accent-hover active:translate-y-1 active:shadow-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto";

export default function LandingCta() {
  const { ready, authenticated } = useEmbeddedWallet();
  const signedIn = DYNAMIC_CONFIGURED && ready && authenticated;
  return (
    <div className="flex flex-col items-center gap-1 sm:flex-row sm:items-center sm:gap-5">
      <Link href={signedIn ? "/pools" : "/character?next=%2Fpools"} className={PRIMARY}>
        {signedIn ? "Go to the lobby" : "Make your player"}
      </Link>
      <Link
        href="/pools"
        className="inline-flex min-h-11 items-center font-bold text-accent-deep underline underline-offset-4 hover:text-foreground"
      >
        See the open runs first
      </Link>
    </div>
  );
}
