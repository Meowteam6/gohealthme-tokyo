import type { Metadata } from "next";
import Lobby from "@/components/game/Lobby";
import { providerConfigured } from "@/lib/server/wearable";

// The Lobby (docs/DESIGN.md). Every run, marked playable or locked for your
// device with the reason and the fix. The decision is lib/game/lobby.ts, built
// on the same join gate and lifecycle rules the pool page uses. Which
// wearables this build can pair is read here, on the server, so a signed-out
// visitor's "What do you wear?" never offers a provider that is not set up.

export const metadata: Metadata = {
  title: "Challenges",
};

export default function PoolsPage() {
  return (
    <Lobby
      availability={{
        junction: providerConfigured("junction"),
        whoop: providerConfigured("whoop"),
        apple: providerConfigured("apple"),
      }}
    />
  );
}
