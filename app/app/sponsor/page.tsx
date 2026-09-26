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
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Sponsor console
          </h1>
          <p className="mt-1 text-sm text-muted">
            Create and fund USDC health-goal pools, and see privacy-safe
            aggregate outcomes.
          </p>
        </div>
        <EmptyState
          title="Sign-in is off on this build"
          detail="This part is not switched on for this build yet. Nothing is wrong on your side."
          action={
            <Link
              href="/pools"
              className="inline-block rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-foreground hover:bg-accent-hover"
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
