import type { Metadata } from "next";
import CreatePool from "@/components/CreatePool";
import { NOINDEX } from "@/lib/site";

// A sponsor's create form: not a public page, and not the pool list either,
// so the canonical inherited from app/pools/layout.tsx is dropped.
export const metadata: Metadata = {
  title: "Start a public challenge",
  robots: NOINDEX,
  alternates: { canonical: null },
};

export default function CreatePoolPage() {
  return <CreatePool />;
}
