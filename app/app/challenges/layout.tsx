import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOINDEX } from "@/lib/site";

// /challenges is a client component; this layout carries its head tags. It
// lists person-aimed dares for one wallet, so it is never indexed.
export const metadata: Metadata = {
  title: "Your dares",
  robots: NOINDEX,
};

export default function ChallengesLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
