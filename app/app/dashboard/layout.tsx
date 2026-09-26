import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOINDEX } from "@/lib/site";

// /dashboard is a client component; this layout carries its head tags. A
// per-wallet page has no business in a search result.
export const metadata: Metadata = {
  title: "My runs",
  robots: NOINDEX,
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return children;
}
