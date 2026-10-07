import type { Metadata } from "next";
import Landing from "@/components/landing/Landing";
import { missRuleFromPoolId } from "@/lib/miss-rule";
import { openBeta } from "@/lib/open-beta";
import { approvalMode } from "@/lib/server/agent/approval-provider";
import { providerConfigured } from "@/lib/server/wearable";
import { worldSetup } from "@/lib/server/world/config";

// Title, description and share card come from the root layout. The landing
// only pins its canonical so tracking or deploy query strings collapse to /.
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// The landing describes THIS deployment, not the roadmap: whether the human
// step is World ID, whether SPOTTER asks a player to confirm before it pays,
// whether the beta is open (lib/open-beta.ts), and which wearables can pair.
// A misconfigured approval mode fails closed on the server (every payout
// holds), so the copy treats it as "confirmation on". The runs themselves are
// read from chain in the browser (components/landing).
function deploymentFlags() {
  const human = worldSetup().mode !== "off";
  let confirm = true;
  try {
    confirm = approvalMode() !== "off";
  } catch {
    confirm = true;
  }
  return {
    human,
    confirm,
    openBeta: openBeta(),
    // No cutoff, no run records a miss: the landing then promises none.
    missRule: missRuleFromPoolId() !== null,
    availability: {
      junction: providerConfigured("junction"),
      whoop: providerConfigured("whoop"),
      apple: providerConfigured("apple"),
    },
  };
}

export default function Home() {
  return <Landing flags={deploymentFlags()} />;
}
