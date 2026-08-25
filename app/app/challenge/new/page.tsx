import type { Metadata } from "next";
import CreateChallenge from "@/components/CreateChallenge";

export const metadata: Metadata = {
  title: "Start a challenge - GoHealthMe",
  description:
    "Stake your own USDC on your own goal and get it back plus a cut of the forfeits, or put up a reward and dare a friend. Verified in a confidential enclave - nobody ever sees the health data.",
};

export default function NewChallengePage() {
  return <CreateChallenge />;
}
