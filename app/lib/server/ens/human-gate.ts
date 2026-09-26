// Names need a human (server only).
//
// A gohealthme.eth subname is minted from GoHealthMe's owner key and paid in
// our Sepolia gas, so without this gate one person with many wallets could
// squat names and drain the key. When prove-human is on for the deployment,
// the signing wallet must be bound to a World-verified human (the same record
// requireHuman reads), and one human gets names on one wallet only.
//
// When prove-human is off (WORLD_VERIFY_MODE unset, or a misconfigured live
// that fails closed to off) nothing changes: the claim behaves as it did
// before, so no deployment gets a new dead end.
//
// STORAGE: ens-human-name-<namespace>-<nullifier>.json { address, label, at }
// is written after a successful mint; a different wallet presenting the same
// human is refused. The human <-> wallet bind (world/human.ts) already allows
// one wallet per human; this record makes the name rule hold on its own.

import { getAddress } from "viem";
import { readJson, writeJson } from "@/lib/server/store";
import { worldNamespace, worldSetup } from "@/lib/server/world/config";
import { getHumanRecord } from "@/lib/server/world/human";

export const NAME_HUMAN_REQUIRED = "Prove you are one human first, then pick your name.";

export const NAME_ONE_PER_HUMAN =
  "You already have a name on another wallet. One human, one name: sign in with that wallet to change it.";

export interface NameHumanDeps {
  /** True when prove-human is on for this deployment. */
  enforced: () => boolean;
  /** A stable key for the wallet's human, or null when it has none. */
  humanOf: (address: string) => Promise<{ key: string } | null>;
}

export function liveNameHumanDeps(): NameHumanDeps {
  return {
    enforced: () => worldSetup().mode !== "off",
    humanOf: async (address) => {
      const record = await getHumanRecord(address);
      if (record === null) return null;
      return { key: `${worldNamespace() ?? "off"}-${record.nullifierHash}` };
    },
  };
}

export type NameHumanCheck =
  | { ok: true; humanKey: string | null }
  | { ok: false; status: 403; reason: string };

interface HumanNameRecord {
  address: string;
  label: string;
  at: string;
}

function recordFile(humanKey: string): string {
  return `ens-human-name-${humanKey}.json`;
}

/** Whether this wallet may take a name right now. */
export async function checkNameHuman(
  address: string,
  deps: NameHumanDeps = liveNameHumanDeps(),
): Promise<NameHumanCheck> {
  if (!deps.enforced()) return { ok: true, humanKey: null };
  const human = await deps.humanOf(address);
  if (human === null) {
    return { ok: false, status: 403, reason: NAME_HUMAN_REQUIRED };
  }
  const held = await readJson<HumanNameRecord | null>(recordFile(human.key), null);
  if (held !== null && held.address.toLowerCase() !== address.toLowerCase()) {
    return { ok: false, status: 403, reason: NAME_ONE_PER_HUMAN };
  }
  return { ok: true, humanKey: human.key };
}

/** Record which wallet holds this human's name. First wallet wins. */
export async function rememberNameHuman(
  humanKey: string | null,
  address: string,
  label: string,
  now: () => number = Date.now,
): Promise<void> {
  if (humanKey === null) return;
  const held = await readJson<HumanNameRecord | null>(recordFile(humanKey), null);
  if (held !== null && held.address.toLowerCase() !== address.toLowerCase()) return;
  await writeJson<HumanNameRecord>(recordFile(humanKey), {
    address: getAddress(address),
    label,
    at: new Date(now()).toISOString(),
  });
}
