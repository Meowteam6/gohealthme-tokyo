"use client";

// The Run: the scoreboard for every run you are in. Nights banked, tonight's
// standing, who is still in, stake and prize, and the run clock.

import Link from "next/link";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import DashboardContent from "@/components/DashboardContent";
import SpotterSays from "@/components/SpotterSays";
import { EmptyState } from "@/components/ui";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <h1 className="font-display text-6xl font-black leading-[0.9] tracking-tight sm:text-7xl">
          My runs
        </h1>
        <SpotterSays
          surface="dashboard-header"
          state="idle"
          pose="lounging"
          say="I hold the wallet. You hold the streak. The board below is the truth."
        />
      </header>
      {DYNAMIC_CONFIGURED ? (
        <DashboardContent />
      ) : (
        <EmptyState
          title="Sign-in is off on this build"
          detail="Without sign-in there are no runs to show. The home page still explains how a run works."
          action={
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded-lg bg-accent px-6 text-sm font-semibold text-white hover:bg-accent-strong"
            >
              Go to the home page
            </Link>
          }
        />
      )}
    </div>
  );
}
