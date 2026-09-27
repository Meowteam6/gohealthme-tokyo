import type { Metadata } from "next";
import CreateChallenge from "@/components/CreateChallenge";
import { NOINDEX } from "@/lib/site";

export const metadata: Metadata = {
  title: "Start a challenge",
  description:
    "Put Base Sepolia test USDC on your own sleep or workout goal and challenge a friend to match it. Your wearable decides, and only the verdict goes on chain, never the health data.",
  robots: NOINDEX,
};

export default function NewChallengePage() {
  return <CreateChallenge />;
}
