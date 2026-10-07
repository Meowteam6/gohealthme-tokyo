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
// before V4.
//
// Open beta (Andre and Nikki, 2026-10-07; lib/open-beta.ts): the browser gate
// is off on purpose. Every page renders; a gated page shows its own
// SignInPanel or SignInGate while signed out; character creation lives on
// /character, where the header's Sign in and every lock fix link go, with
// World ID as an optional step 2. With the flag off, the closed beta above
// holds, and the Playwright suite's meaning of the flag is unchanged.

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Card, Skeleton } from "@/components/ui";
import Perch from "@/components/spotter/Perch";
import SpotterCaption from "@/components/spotter/SpotterCaption";
import CharacterCreation from "@/components/game/CharacterCreation";
import { useCharacter } from "@/lib/game/useCharacter";
import { useOnboarding } from "@/lib/game/onboarding-store";
import { creationBlocks, hardGateClosed } from "@/lib/game/character";
import { openBeta } from "@/lib/open-beta";
import { rendersWithoutGate } from "@/lib/public-paths";
import { useEmbeddedWallet } from "@/lib/wallet";

export function GateLoading() {
  return (
    <div className="mx-auto w-full max-w-xl py-2" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading your player
      </p>
      {/* The same shape as the character card it resolves into, so nothing
          jumps when the player loads. */}
      <Perch state="loading" width={[84, 120]} side="right" inset={[16, 28]} decorative>
        <Card>
          <Skeleton className="h-10 w-2/3" />
          <SpotterCaption line="Looking up your player." className="mt-4" />
          <Skeleton className="mt-4 h-40 w-full rounded-control" />
        </Card>
      </Perch>
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
  // Open beta: the browser gate is off on purpose (header). The same reader
  // the join checks and the server's isAllowed use, so the three agree.
  const gateDisabled = openBeta();
  // A run page is a read-only preview while signed out (lib/public-paths.ts).
  if (gateDisabled || rendersWithoutGate(pathname, { ready, signedIn: authenticated })) {
    return <>{children}</>;
  }
  return <CharacterGate>{children}</CharacterGate>;
}
