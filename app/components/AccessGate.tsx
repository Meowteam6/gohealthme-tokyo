"use client";

// The gate, now character creation. Wraps the page content in the root layout.
//
// Public surfaces (the landing page, legal pages, public profiles, and invite
// links) always render: a visitor sees the pitch, and an invited friend can
// read a dare before signing in. Everything else shows character creation
// until the two hard steps pass (signed in; World proof-of-human or the
// closed-beta allowlist), then once more for the skippable onboarding pass
// (name, sensor), then never again on this device.
//
// This is a UX gate. It decides what the browser SHOWS; the server decides what
// actually happens (isAllowed on gated routes). The two stay separate so a
// determined caller cannot talk their way past enforcement by editing client
// state. With World off for a build, the allowlist behaves exactly as it did
// before V4, and there is no skip that works on a deployed environment.

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Skeleton } from "@/components/ui";
import CharacterCreation from "@/components/game/CharacterCreation";
import { useCharacter } from "@/lib/game/useCharacter";
import { useOnboarding } from "@/lib/game/onboarding-store";

// Exact public paths and public path prefixes. Keep in sync with the route map;
// anything not listed here is gated.
const PUBLIC_EXACT = new Set(["/", "/privacy", "/terms"]);
const PUBLIC_PREFIXES = ["/u/", "/c/"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function GateLoading() {
  return (
    <div className="mx-auto w-full max-w-xl space-y-4 py-2" aria-busy="true">
      <p className="sr-only" aria-live="polite">
        Loading your player
      </p>
      <Skeleton className="h-14 w-2/3" />
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-64 w-full" />
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

  if (view.gateLoading || !onboarding.hydrated) return <GateLoading />;

  if (!view.gate) {
    return <CharacterCreation view={view} onboarding={onboarding} mode="gate" />;
  }

  if (!onboarding.done && !onCharacterPage) {
    return <CharacterCreation view={view} onboarding={onboarding} mode="gate" />;
  }

  return <>{children}</>;
}

export default function AccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Playwright-only switch (playwright.config.ts). Never set on a deployed
  // environment: it opens the closed beta (CLAUDE.md landmine 3).
  const gateDisabled = process.env.NEXT_PUBLIC_ACCESS_GATE_DISABLED === "1";
  if (gateDisabled || isPublicPath(pathname)) return <>{children}</>;
  return <CharacterGate>{children}</CharacterGate>;
}
