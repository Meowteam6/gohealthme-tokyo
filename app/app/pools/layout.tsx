import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TITLE_TEMPLATE } from "@/lib/site";

// /pools is a client component and cannot export metadata, so its head tags
// live here. Child routes (/pools/[id], /pools/create) set their own title
// and canonical and inherit this description. The template is restated so
// those child titles keep the " - GoHealthMe" suffix from the root.
export const metadata: Metadata = {
  title: { default: "Live pools", template: TITLE_TEMPLATE },
  description:
    "Live health-goal pools: sleep, steps, workouts, preventive care. Stake test USDC, hit the goal, get paid when it is verified. Base Sepolia testnet, play money.",
  alternates: { canonical: "/pools" },
};

export default function PoolsLayout({ children }: { children: ReactNode }) {
  return children;
}
