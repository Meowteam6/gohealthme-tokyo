"use client";

// The gate, now character creation. Wraps the page content in the root layout.
//
// Public surfaces (the landing page, legal pages, public profiles, invite
// links, the lobby and the payout feed; lib/public-paths.ts) always render: a
// visitor sees the pitch and the open runs, and an invited friend can read a
// dare before signing in. Everything else shows character creation
// until the two hard steps pass (signed in; World proof-of-human or the
// closed-beta allowlist). A player who makes their character here is walked
// through the skippable onboarding pass (name, wearable) once. A returning
// player on any device, whose hard steps are already done server-side, walks
// straight in: the per-device flag only remembers skips, it never gates.
//
// This is a UX gate. It decides what the browser SHOWS; the server decides what
// actually happens (isAllowed on gated routes). The two stay separate so a
// determined caller cannot talk their way past enforcement by editing client
// state. With World off for a build, the allowlist behaves exactly as it did
// before V4, and there is no skip that works on a deployed environment.

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Skeleton } from "@/components/ui";
import Spotter from "@/components/spotter/Spotter";
import CharacterCreation from "@/components/game/CharacterCreation";
import { useCharacter } from "@/lib/game/useCharacter";
import { useOnboarding } from "@/lib/game/onboarding-store";
import { creationBlocks, hardGateClosed } from "@/lib/game/character";
import { rendersWithoutGate } from "@/lib/public-paths";
import { useEmbeddedWallet } from "@/lib/wallet";

function GateLoading() {
  return (
    <div className="mx-auto w-full max-w-xl space-y-4 py-2" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading your player
      </p>
      <Spotter state="loading" size="sm" line="Looking up your player." decorative />
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-48 w-full rounded-3xl" />
    </div>
  );
}

function CharacterGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const view = useCharacter();
  const onboarding = useOnboarding(view.address);

  // The /character page renders its own editor; the gate only guards the hard
  // steps there, so the page is never shown twice.
  const onCharacterPage = pathname === "/character";

  // Latched per wallet: once this device has seen the player at a closed hard
  // gate, they are creating their character here and get the onboarding pass.
  // Adjusting state during render (not in an effect) keeps it one render.
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const closedNow = hardGateClosed({
    authenticated: view.authenticated,
    address: view.address,
    gate: view.gate,
    gateLoading: view.gateLoading,
    accessLoading: view.access.loading,
    worldLane: view.worldLane,
  });
  if (closedNow && view.address !== null && creatingFor !== view.address) {
    setCreatingFor(view.address);
  }
  const creatingHere = view.address !== null && creatingFor === view.address;

  if (view.gateLoading || !onboarding.hydrated) return <GateLoading />;

  if (!view.gate) {
    return <CharacterCreation view={view} onboarding={onboarding} mode="gate" />;
  }

  if (
    !onCharacterPage &&
    creationBlocks({
      steps: view.steps,
      gate: view.gate,
      skipped: onboarding.skipped,
      onboarded: onboarding.done,
      creatingHere: creatingHere || closedNow,
    })
  ) {
    return <CharacterCreation view={view} onboarding={onboarding} mode="gate" />;
  }

  return <>{children}</>;
}

export default function AccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { ready, authenticated } = useEmbeddedWallet();
  // Playwright-only switch (playwright.config.ts). Never set on a deployed
  // environment: it opens the closed beta (CLAUDE.md landmine 3).
  const gateDisabled = process.env.NEXT_PUBLIC_ACCESS_GATE_DISABLED === "1";
  // A run page is a read-only preview while signed out (lib/public-paths.ts).
  if (gateDisabled || rendersWithoutGate(pathname, { ready, signedIn: authenticated })) {
    return <>{children}</>;
  }
  return <CharacterGate>{children}</CharacterGate>;
}
