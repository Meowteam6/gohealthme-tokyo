import type { Metadata } from "next";
import Link from "next/link";
import NamedPayoutFeed from "@/components/NamedPayoutFeed";

export const metadata: Metadata = {
  title: "Who got paid",
  description:
    "Recent health-goal payouts SPOTTER has settled on Base Sepolia, by handle. Amounts and transactions are public; the health category never is. Testnet play money.",
  alternates: { canonical: "/feed" },
};

export default function FeedPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Who got paid
          </h1>
          <p className="text-sm text-muted">
            Recent payouts SPOTTER has settled on Base Sepolia, named by
            handle where the wallet has claimed one. The amount and the
            settlement tx are public; the health goal behind each one never
            is. Test USDC, not real money.
          </p>
        </div>
        {/* SPOTTER on payday - eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/spotter/spotter-payday.png"
          alt=""
          aria-hidden="true"
          className="hidden h-24 w-auto shrink-0 drop-shadow-sm sm:block"
        />
      </div>

      <NamedPayoutFeed />

      <p className="text-center text-sm text-muted">
        <Link
          href="/character"
          className="inline-flex min-h-11 items-center text-accent-deep underline-offset-4 hover:underline"
        >
          Pick a name
        </Link>{" "}
        to show up here by name.
      </p>
    </div>
  );
}
