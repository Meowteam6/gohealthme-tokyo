"use client";

// My runs: the Run for every run you are in. Time left as the one big number,
// nights as pebbles, who is still in, stake and pot, then finished runs.
// DashboardContent owns the header, so SPOTTER stands on whichever card leads
// the page in its current state (docs/DESIGN.md, one pose per viewport).

import Link from "next/link";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import DashboardContent from "@/components/DashboardContent";
import { EmptyCard, PAGE_COLUMN, PerchedHeader } from "@/components/night/kit";
import { buttonClasses } from "@/components/ui";

export default function DashboardPage() {
  if (DYNAMIC_CONFIGURED) {
    return (
      <div className={PAGE_COLUMN}>
        <DashboardContent />
      </div>
    );
  }
  return (
    <PerchedHeader title="My challenges" pose="meditate" className={PAGE_COLUMN}>
      <EmptyCard
        title="Sign-in is off on this build"
        detail="Without sign-in there are no challenges to show. The home page still explains how a challenge works."
        action={
          <Link href="/" className={buttonClasses({ size: "sm" })}>
            Go to the home page
          </Link>
        }
      />
    </PerchedHeader>
  );
}
