import type { Metadata } from "next";
import GoalMatch from "@/components/GoalMatch";
import { NOINDEX } from "@/lib/site";

export const metadata: Metadata = {
  title: "Your goal",
  description: "Open health-goal runs matched to the goal you typed.",
  robots: NOINDEX,
};

export default async function GoalPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return <GoalMatch query={q ?? ""} />;
}
