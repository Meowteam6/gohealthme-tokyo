import type { Metadata } from "next";
import Lobby from "@/components/game/Lobby";

// The Lobby (docs/DESIGN.md). Every run, marked playable or locked for your
// device with the reason and the fix. The decision is lib/game/lobby.ts, built
// on the same join gate and lifecycle rules the pool page uses.

export const metadata: Metadata = {
  title: "The lobby",
};

export default function PoolsPage() {
  return <Lobby />;
}
