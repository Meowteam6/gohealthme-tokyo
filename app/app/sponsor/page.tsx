import type { Metadata } from "next";
import Link from "next/link";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import SponsorConsole from "@/components/SponsorConsole";
import { EmptyState } from "@/components/ui";

export const metadata: Metadata = {
  title: "Sponsor a health goal",
  description:
    "Create and fund USDC health-goal pools and see privacy-safe aggregate outcomes. No participant health data is ever shown. Base Sepolia testnet, play-money USDC.",
  alternates: { canonical: "/sponsor" },
};

// Server component that mirrors the dashboard: it only gates on whether sign-in
// is configured and hands off to the client console. When Dynamic is unset the
// console cannot pull USDC from a wallet, so the page says so honestly rather
// than rendering a create form that can never submit.
export default function SponsorPage() {
  if (!DYNAMIC_CONFIGURED) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-[2rem] font-extrabold leading-display tracking-display sm:text-[2.5rem]">
            Sponsor console
          </h1>
          <p className="mt-2 text-base text-muted">
            Create and fund USDC health-goal pools, and see privacy-safe
            aggregate outcomes.
          </p>
        </div>
        <EmptyState
          line="Nobody can sign in, so there is no pot to hold. I'm on break."
          title="Sign-in is off on this build"
          detail="This part is not switched on for this build yet. Nothing is wrong on your side."
          action={
            <Link
              href="/pools"
              className="inline-flex min-h-12 items-center justify-center rounded-[18px] bg-accent px-5 py-3 text-base font-bold text-foreground shadow-[var(--shadow-pop)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
            >
              Browse pools instead
            </Link>
          }
        />
      </div>
    );
  }
  return <SponsorConsole />;
}
