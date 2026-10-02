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
//
// RE-PICK CAP: the record also counts distinct names minted for the human.
// After ENS_NAMES_PER_HUMAN (default 3) a new name is refused before any mint;
// re-claiming the current name never counts, and linking a .eth the player
// already owns mints nothing, so the cap never refuses it (NAME_CAP_REACHED
// points a capped player there). namesLeft() lets the claim form say so
// before the player types or signs anything.
//
// WORLD PAUSED (KILL_WORLD_ID, 2026-10-02). The pause switches worldSetup()
// off, which used to drop the cap with it. Now, on a build where World is
// configured but paused:
//   - a wallet with a World binding (boundWorldNamespace(), the binding store
//     World already wrote) keeps its human's key, so one name per human and
//     the pick cap hold on the same record as before the pause.
//   - a wallet with no binding (a new list player) is never refused for
//     lacking World ID: the pause gives them no way to get one, and the
//     character step shows the name claim as open. They get
//     ENS_NAMES_PER_HUMAN names counted on that wallet (key wallet-<address>),
//     the same picks a human gets, so the pause is not an endless re-pick
//     window. The list has no human to count, so one person with several
//     list wallets is bounded per wallet only, as on a build without World.
// A build without World configured is unchanged by the switch: no gate, no
// cap, exactly as before.

import { getAddress } from "viem";
import { NAME_CAP_REACHED } from "@/lib/ens/names";
import { readJson, writeJson } from "@/lib/server/store";
import { boundWorldNamespace, worldNamespace, worldSetup } from "@/lib/server/world/config";
import { getHumanRecord } from "@/lib/server/world/human";

export const NAME_HUMAN_REQUIRED = "Prove you are one human first, then pick your name.";

export const NAME_ONE_PER_HUMAN =
  "You already have a name on another wallet. One human, one name: sign in with that wallet to change it.";

export { NAME_CAP_REACHED };

const DEFAULT_NAMES_PER_HUMAN = 3;

/** How many distinct gohealthme.eth names one human may mint. */
export function namesPerHuman(): number {
  const raw = Number.parseInt(process.env.ENS_NAMES_PER_HUMAN ?? "", 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : DEFAULT_NAMES_PER_HUMAN;
}

export interface NameHumanDeps {
  /** True when names are gated and capped on this deployment: prove-human is
   *  on, or World is configured and paused (see the header). */
  enforced: () => boolean;
  /** A stable key for the wallet's human, or null when it has none. While
   *  World is paused a wallet with no binding answers its wallet key. */
  humanOf: (address: string) => Promise<{ key: string } | null>;
}

/** The cap key for a wallet with no World binding while World is paused. */
function walletKey(address: string): string {
  return `wallet-${address.toLowerCase()}`;
}

export function liveNameHumanDeps(): NameHumanDeps {
  return {
    enforced: () => {
      const setup = worldSetup();
      return setup.mode !== "off" || setup.paused === true;
    },
    humanOf: async (address) => {
      const setup = worldSetup();
      if (setup.mode !== "off") {
        const record = await getHumanRecord(address);
        if (record === null) return null;
        return { key: `${worldNamespace(setup) ?? "off"}-${record.nullifierHash}` };
      }
      if (setup.paused !== true) return null;
      // Paused: World's bindings still name their human; everyone else is
      // counted on their own wallet.
      const bound = boundWorldNamespace();
      const record = bound === null ? null : await getHumanRecord(address, bound);
      if (record !== null) return { key: `${bound}-${record.nullifierHash}` };
      return { key: walletKey(address) };
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
  /** Distinct names minted for this human. Absent on older records: one. */
  picks?: number;
}

function picksOf(record: HumanNameRecord | null): number {
  if (record === null) return 0;
  return record.picks ?? 1;
}

function recordFile(humanKey: string): string {
  return `ens-human-name-${humanKey}.json`;
}

/** Whether this wallet may take this name right now. */
export async function checkNameHuman(
  address: string,
  deps: NameHumanDeps = liveNameHumanDeps(),
  label?: string,
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
  // No label is a link of a .eth the player owns: nothing is minted, so the
  // pick cap does not apply (only the one-name-per-human rule above).
  const isCurrent = held !== null && label !== undefined && held.label === label;
  if (label !== undefined && !isCurrent && picksOf(held) >= namesPerHuman()) {
    return { ok: false, status: 403, reason: NAME_CAP_REACHED };
  }
  return { ok: true, humanKey: human.key };
}

/**
 * New names this wallet's human can still pick, or null when there is no cap
 * (prove-human off) or no human yet (the human gate answers that case).
 */
export async function namesLeft(
  address: string,
  deps: NameHumanDeps = liveNameHumanDeps(),
): Promise<number | null> {
  if (!deps.enforced()) return null;
  const human = await deps.humanOf(address);
  if (human === null) return null;
  const held = await readJson<HumanNameRecord | null>(recordFile(human.key), null);
  if (held !== null && held.address.toLowerCase() !== address.toLowerCase()) return 0;
  return Math.max(0, namesPerHuman() - picksOf(held));
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
  const picks = held !== null && held.label === label ? picksOf(held) : picksOf(held) + 1;
  await writeJson<HumanNameRecord>(recordFile(humanKey), {
    address: getAddress(address),
    label,
    at: new Date(now()).toISOString(),
    picks,
  });
}
