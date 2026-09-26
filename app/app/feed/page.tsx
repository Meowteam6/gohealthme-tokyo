import type { Metadata } from "next";
import Link from "next/link";
import NamedPayoutFeed from "@/components/NamedPayoutFeed";
import Spotter from "@/components/spotter/Spotter";

export const metadata: Metadata = {
  title: "Who got paid",
  description:
    "Recent health-goal payouts SPOTTER has settled on Base Sepolia, by handle. Amounts and transactions are public; the health category never is. Testnet play money.",
  alternates: { canonical: "/feed" },
};

export default function FeedPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-4">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="break-words font-display text-[1.75rem] font-extrabold leading-display tracking-display sm:text-[2.5rem]">
            Who got paid
          </h1>
          <p className="text-base text-muted">
            Recent payouts SPOTTER has settled on Base Sepolia, named by
            handle where the wallet has claimed one. The amount and the
            settlement tx are public; the health goal behind each one never
            is. Test USDC, not real money.
          </p>
        </div>
        <div className="hidden shrink-0 sm:block">
          <Spotter pose="payday" size="sm" decorative />
        </div>
        <div className="shrink-0 sm:hidden">
          <Spotter pose="payday" size="xs" decorative />
        </div>
      </div>

      <NamedPayoutFeed />

      <p className="text-center text-sm text-muted">
        <Link
          href="/character"
          className="inline-flex min-h-11 items-center font-bold text-accent-deep underline underline-offset-4"
        >
          Pick a name
        </Link>{" "}
        to show up here by name.
      </p>
    </div>
  );
}
