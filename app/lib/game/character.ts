// Lane contract (docs/LANES.md): the character card every screen reads. Owned by the UX lane.
// Lanes never edit this file; they feed it through the APIs named in docs/LANES.md.

export type HumanStatus = "unknown" | "verified" | "unverified";

export interface CharacterDevice {
  provider: string;
  label: string;
  metrics: string[];
}

export interface Character {
  address: string;
  human: HumanStatus;
  name: string | null;
  device: CharacterDevice | null;
}

export function isReadyToPlay(c: Character): boolean {
  return c.human === "verified" && c.name !== null && c.device !== null;
}
