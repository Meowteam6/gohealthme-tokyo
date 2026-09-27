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
// When WORLD_VERIFY_MODE is unset this is a no-op that says so (`enforced:
// false`), so a deployment without World configured behaves as before.

import { isAddress } from "viem";
import { worldSetup } from "@/lib/server/world/config";
import { isVerifiedHuman } from "@/lib/server/world/human";

export const HUMAN_REQUIRED_REASON =
  "Prove you're one human before playing this challenge. Open your character card and complete the World ID step, then try again. Nothing was verified or paid.";

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
  return { ok: false, status: 403, reason: HUMAN_REQUIRED_REASON };
}
