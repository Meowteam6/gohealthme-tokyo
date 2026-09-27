"use client";

// /character: the player's card and every step, editable. The lobby's lock
// fixes link here with ?step= and ?next=, so a fix always ends with the way
// back to the run it unlocked: "< Back to the run", as the run page opens
// with "< Open runs".

import CharacterCreation from "@/components/game/CharacterCreation";
import { useCharacter } from "@/lib/game/useCharacter";
import { useOnboarding } from "@/lib/game/onboarding-store";
import type { StepId } from "@/lib/game/character";
import { BackLink } from "@/components/night/kit";

/** Where ?next= goes, in the one vocabulary: one challenge (its page or its
 *  link), the challenges board, or anywhere else. */
function backLabel(next: string): string {
  if (/^\/(pools\/[^/?#]+|c\/)/.test(next)) return "Back to the challenge";
  if (/^\/pools(?:[?#]|$)/.test(next)) return "Back to challenges";
  return "Back";
}

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
    <CharacterCreation
      view={view}
      onboarding={onboarding}
      focus={focus}
      mode="page"
      above={next !== null ? <BackLink href={next}>{backLabel(next)}</BackLink> : undefined}
    />
  );
}
