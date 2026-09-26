import type { Metadata } from "next";
import Link from "next/link";
import NamedPayoutFeed from "@/components/NamedPayoutFeed";
import { PAGE_COLUMN, PerchedHeader } from "@/components/night/kit";
import { TEXT_LINK } from "@/components/ui";

export const metadata: Metadata = {
  title: "Who got paid",
  description:
    "Recent health-goal payouts SPOTTER has settled on Base Sepolia, by handle. Amounts and transactions are public; the health category never is. Testnet play money.",
  alternates: { canonical: "/feed" },
};

export default function FeedPage() {
  return (
    <div className={`${PAGE_COLUMN} [&>*+*]:mt-6`}>
      <PerchedHeader
        title="Who got paid"
        lead="Recent payouts on Base Sepolia, named by handle where the wallet has claimed one. The amount and the settlement tx are public; the health goal behind each one never is. Test USDC, not real money."
        pose="thumbsup"
      >
        <NamedPayoutFeed />
      </PerchedHeader>

      <p className="text-center text-[0.9375rem] text-muted">
        <Link href="/character" className={TEXT_LINK}>
          Pick a name
        </Link>{" "}
        to show up here by name.
      </p>
    </div>
  );
}
