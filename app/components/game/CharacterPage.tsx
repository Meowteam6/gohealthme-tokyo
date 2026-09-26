"use client";

// /character: the player's card and every step, editable. The lobby's lock
// fixes link here with ?step= and ?next=, so a fix always ends with the way
// back to the run it unlocked.

import Link from "next/link";
import CharacterCreation from "@/components/game/CharacterCreation";
import { useCharacter } from "@/lib/game/useCharacter";
import { useOnboarding } from "@/lib/game/onboarding-store";
import type { StepId } from "@/lib/game/character";
import { buttonClasses } from "@/components/ui";

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
          className={`${buttonClasses({ variant: "secondary", size: "sm" })}`}
        >
          Back to the run
        </Link>
      ) : null}
      <CharacterCreation view={view} onboarding={onboarding} focus={focus} mode="page" />
    </div>
  );
}
