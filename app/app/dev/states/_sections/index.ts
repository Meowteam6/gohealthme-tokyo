import type { ComponentType } from "react";
import type { GallerySectionMeta, SectionProps } from "../_kit";
import FoundationStates from "./foundation";
import LandingStates from "./landing";
import RunStates from "./run";
import VerdictStates from "./verdict";
import LobbyStates from "./lobby";
import ShellStates from "./shell";
import OnboardingStates from "./onboarding";
import ChallengeStates from "./challenges";

// Every gallery section, in page order, with its id, title and owner. Each
// screen owns its own file in this folder, so filling a section never touches
// this list or anyone else's file. Metas live here, not in the section files,
// because a "use client" section cannot hand plain objects to the server page.
export const SECTIONS: readonly {
  meta: GallerySectionMeta;
  Component: ComponentType<SectionProps>;
}[] = [
  { meta: { id: "foundation", title: "Foundation", owner: "foundation" }, Component: FoundationStates },
  { meta: { id: "landing", title: "Landing", owner: "landing agent" }, Component: LandingStates },
  { meta: { id: "run", title: "Challenge page", owner: "run-page agent" }, Component: RunStates },
  { meta: { id: "verdict", title: "Verdict", owner: "verdict agent" }, Component: VerdictStates },
  { meta: { id: "lobby", title: "Lobby, My challenges, History", owner: "lobby agent" }, Component: LobbyStates },
  { meta: { id: "shell", title: "Shell", owner: "shell agent" }, Component: ShellStates },
  { meta: { id: "onboarding", title: "Character creation", owner: "onboarding agent" }, Component: OnboardingStates },
  { meta: { id: "challenges", title: "Challenges", owner: "challenges agent" }, Component: ChallengeStates },
];
