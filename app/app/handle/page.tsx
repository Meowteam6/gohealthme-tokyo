import type { Metadata } from "next";
import ClaimHandle from "@/components/ClaimHandle";
import { PAGE_COLUMN, PerchedHeader } from "@/components/night/kit";
import { Card } from "@/components/ui";
import { NOINDEX } from "@/lib/site";

export const metadata: Metadata = {
  title: "Claim your handle",
  robots: NOINDEX,
};

export default function HandlePage() {
  return (
    <PerchedHeader
      className={PAGE_COLUMN}
      title="Claim your handle"
      lead="A handle turns your wallet address into a name. It replaces 0x1234...abcd across the app and gives you a public page at /u/your-handle with the challenges you hit and what they paid, never the health goal behind them."
      pose="wave"
    >
      <Card>
        <ClaimHandle />
      </Card>
    </PerchedHeader>
  );
}
