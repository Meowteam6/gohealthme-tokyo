"use client";

// The landing goal box. The product inverts here: instead of a cold-start
// grid of strangers' pools, you say the thing you have been putting off and
// get routed to the money already staked on it.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClasses } from "@/components/ui";

export default function GoalIntent() {
  const router = useRouter();
  const [goal, setGoal] = useState("");

  const go = () => {
    const query = goal.trim();
    router.push(query === "" ? "/goal" : `/goal?q=${encodeURIComponent(query)}`);
  };

  return (
    <form
      className="mx-auto mt-8 flex w-full max-w-xl flex-col gap-3 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <input
        type="text"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="the thing you have been putting off"
        aria-label="Your goal"
        className="w-full flex-1 rounded-xl border border-edge bg-surface px-5 py-4 text-base text-foreground placeholder:text-muted focus:border-accent/60 focus:outline-none"
      />
      {/* Self-stake is the default now: you put your own USDC on your own goal
          and get it back plus a cut of the forfeits. Sponsor-funded pools still
          exist, but the premise is you backing you - so the CTA is about staking
          on the goal, not collecting somebody else's money. */}
      <button
        type="submit"
        className={`${buttonClasses()}`}
      >
        Stake on it
      </button>
    </form>
  );
}
