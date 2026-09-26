import type { Metadata } from "next";
import Link from "next/link";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import SponsorConsole from "@/components/SponsorConsole";
import { EmptyCard, PAGE_COLUMN, PerchedHeader } from "@/components/night/kit";
import { buttonClasses } from "@/components/ui";

export const metadata: Metadata = {
  title: "Sponsor a health goal",
  description:
    "Create and fund USDC health-goal runs and see privacy-safe aggregate outcomes. No player health data is ever shown. Base Sepolia testnet, play-money USDC.",
  alternates: { canonical: "/sponsor" },
};

// Server component that mirrors the dashboard: it only gates on whether sign-in
// is configured and hands off to the client console. When Dynamic is unset the
// console cannot pull USDC from a wallet, so the page says so honestly rather
// than rendering a create form that can never submit.
export default function SponsorPage() {
  if (!DYNAMIC_CONFIGURED) {
    return (
      <PerchedHeader
        className={PAGE_COLUMN}
        title="Sponsor console"
        lead="Create and fund USDC health-goal runs, and see privacy-safe aggregate outcomes."
        pose="meditate"
      >
        <EmptyCard
          title="Sign-in is off on this build"
          detail="This part is not switched on for this build yet. Nothing is wrong on your side."
          action={
            <Link href="/pools" className={buttonClasses({ size: "sm" })}>
              See the open runs
            </Link>
          }
        />
      </PerchedHeader>
    );
  }
  return <SponsorConsole />;
}
