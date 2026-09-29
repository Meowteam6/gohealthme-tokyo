// The server-side teeth of "one human, one entry".
//
// joinPool is an on-chain call the browser makes directly, so the server
// cannot refuse a stake at the contract. What it CAN refuse is everything
// that turns a stake into money: SPOTTER will not verify or pay a wallet that
// has not proven it is one human. The join surfaces withhold the stake button
// until the wallet is verified (ProveHuman + useHumanStatus), so an honest
// user never reaches this refusal; only a caller who bypassed the product and
// staked by hand does, and the reason tells them how to fix it.
//
// When WORLD_VERIFY_MODE is unset, or World is switched off by KILL_WORLD_ID,
// this is a no-op that says so (`enforced: false`), so a deployment without
// World behaves as before and SPOTTER keeps paying through a pause.
//
// WHO COUNTS AS ONE HUMAN (Andre, 2026-09-30). A World-verified wallet, an
// admin, or an approved closed-beta list entry. World is the self-serve way
// in; the list is the way in for someone without World ID, and character
// creation offers it ("No World ID? Ask for a spot on the list instead"). An
// approved list player used to get in and then find every challenge locked,
// with SPOTTER refusing their claims here: a way in that led nowhere. The
// client decides the same way (lib/game/character.ts characterOf).

import { isAddress } from "viem";
import { getAccessRecord, isAdmin } from "@/lib/server/access";
import { worldSetup } from "@/lib/server/world/config";
import { isVerifiedHuman } from "@/lib/server/world/human";

export const HUMAN_REQUIRED_REASON =
  "Prove you're one human before playing this challenge. Open your character card and complete the World ID step, or get your spot on the list approved, then try again. Nothing was verified or paid.";

/** An admin, or a closed-beta request an admin approved. */
async function onTheList(address: string): Promise<boolean> {
  if (isAdmin(address)) return true;
  return (await getAccessRecord(address))?.status === "approved";
}

export type RequireHumanResult =
  | { ok: true; enforced: boolean }
  | { ok: false; status: 403; reason: string };

export async function requireHuman(
  address: string,
): Promise<RequireHumanResult> {
  if (worldSetup().mode === "off") return { ok: true, enforced: false };
  if (!isAddress(address)) {
    return { ok: false, status: 403, reason: HUMAN_REQUIRED_REASON };
  }
  if (await isVerifiedHuman(address)) return { ok: true, enforced: true };
  if (await onTheList(address)) return { ok: true, enforced: true };
  return { ok: false, status: 403, reason: HUMAN_REQUIRED_REASON };
}
