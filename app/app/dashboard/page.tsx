"use client";

// My runs: the Run for every run you are in. Time left as the one big number,
// nights as pebbles, who is still in, stake and pot, then finished runs.

import Link from "next/link";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import DashboardContent from "@/components/DashboardContent";
import SpotterSays from "@/components/SpotterSays";
import { EmptyState, buttonClasses } from "@/components/ui";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <h1 className="font-display text-[clamp(2.5rem,12vw,4rem)] font-extrabold leading-display tracking-[-0.03em]">
          My runs
        </h1>
        <SpotterSays
          surface="dashboard-header"
          state="idle"
          pose="wallet"
          say="I hold the wallet. You hold the streak. The board below is the truth."
        />
      </header>
      {DYNAMIC_CONFIGURED ? (
        <DashboardContent />
      ) : (
        <EmptyState
          title="Sign-in is off on this build"
          line="No sign-in, no runs. I'm on break."
          detail="Without sign-in there are no runs to show. The home page still explains how a run works."
          action={
            <Link href="/" className={buttonClasses()}>
              Go to the home page
            </Link>
          }
        />
      )}
    </div>
  );
}
