import type { Metadata } from "next";
import CreateChallenge from "@/components/CreateChallenge";
import { NOINDEX } from "@/lib/site";

export const metadata: Metadata = {
  title: "Start a challenge",
  description:
    "Stake your own USDC on your own goal and get it back when you hit it, or put up a reward and dare a friend. Verified in a confidential enclave - nobody ever sees the health data.",
  robots: NOINDEX,
};

export default function NewChallengePage() {
  return <CreateChallenge />;
}
