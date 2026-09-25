import type { Metadata } from "next";
import CharacterPage from "@/components/game/CharacterPage";
import { NOINDEX } from "@/lib/site";
import { STEP_ORDER, type StepId } from "@/lib/game/character";

export const metadata: Metadata = {
  title: "Your player",
  robots: NOINDEX,
};

function stepParam(value: string | string[] | undefined): StepId | null {
  return typeof value === "string" && (STEP_ORDER as string[]).includes(value)
    ? (value as StepId)
    : null;
}

/** Same-origin paths only: an open redirect through ?next= would hand a
 *  signed-in player to any site the link author chose. */
function nextParam(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  return value;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <CharacterPage focus={stepParam(params.step)} next={nextParam(params.next)} />;
}
