"use client";

// The landing's one call to action. Signed out it starts character creation;
// signed in it goes straight to the lobby. One button, never two sign-in flows
// competing for the same tap.

import Link from "next/link";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { useEmbeddedWallet } from "@/lib/wallet";
import { ChevronLink, buttonClasses } from "@/components/ui";

export default function LandingCta() {
  const { ready, authenticated } = useEmbeddedWallet();
  const signedIn = DYNAMIC_CONFIGURED && ready && authenticated;
  return (
    <div className="flex flex-col items-stretch gap-1">
      <Link
        href={signedIn ? "/pools" : "/character?next=%2Fpools"}
        className={buttonClasses({ block: true })}
      >
        {signedIn ? "Go to the lobby" : "Make your player"}
      </Link>
      <ChevronLink href="/pools" className="self-center">
        See the open runs first
      </ChevronLink>
    </div>
  );
}
