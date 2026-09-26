import type { Metadata } from "next";
import CreateChallenge from "@/components/CreateChallenge";
import { NOINDEX } from "@/lib/site";

export const metadata: Metadata = {
  title: "Start a challenge",
  description:
    "Stake Base Sepolia test USDC on your own sleep or workout goal, or put up a reward and challenge a friend. Your wearable decides, and only the verdict goes on chain, never the health data.",
  robots: NOINDEX,
};

export default function NewChallengePage() {
  return <CreateChallenge />;
}
