"use client";

// /character: the player's card and every step, editable. The lobby's lock
// fixes link here with ?step= and ?next=, so a fix always ends with the way
// back to the run it unlocked.

import Link from "next/link";
import CharacterCreation from "@/components/game/CharacterCreation";
import { useCharacter } from "@/lib/game/useCharacter";
import { useOnboarding } from "@/lib/game/onboarding-store";
import type { StepId } from "@/lib/game/character";

export default function CharacterPage({
  focus,
  next,
}: {
  focus: StepId | null;
  next: string | null;
}) {
  const view = useCharacter();
  const onboarding = useOnboarding(view.address);
  return (
    <div className="space-y-6">
      {next !== null ? (
        <Link
          href={next}
          className="inline-flex min-h-11 items-center rounded-[18px] border-2 border-foreground bg-transparent px-4 font-bold hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
        >
          Back to the run
        </Link>
      ) : null}
      <CharacterCreation view={view} onboarding={onboarding} focus={focus} mode="page" />
    </div>
  );
}
