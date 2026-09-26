import type { Metadata } from "next";
import Link from "next/link";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import WalletSettings from "@/components/WalletSettings";
import { EmptyCard, PAGE_COLUMN, PerchedHeader } from "@/components/night/kit";
import { buttonClasses } from "@/components/ui";
import { NOINDEX } from "@/lib/site";

export const metadata: Metadata = {
  title: "Settings",
  description:
    "Your GoHealthMe settings: wallet address, Base Sepolia balance, your name, your paired wearable and how to disconnect it, and how to back the wallet up.",
  robots: NOINDEX,
};

// SPOTTER stands on the first settings card (docs/DESIGN.md, one pose per
// viewport): the wallet card when signed in, the sign-in card when not.
export default function SettingsPage() {
  return (
    <PerchedHeader
      className={PAGE_COLUMN}
      title="Settings"
      lead="Your wallet and where your test USDC lives, the name you play under, and the wearable SPOTTER reads."
      pose="wearable"
    >
      {DYNAMIC_CONFIGURED ? (
        <WalletSettings />
      ) : (
        <EmptyCard
          title="Sign-in is off on this build"
          detail="Without sign-in there is no wallet to show here. The home page still explains how a run works."
          action={
            <Link href="/" className={buttonClasses({ size: "sm" })}>
              Go to the home page
            </Link>
          }
        />
      )}
    </PerchedHeader>
  );
}
