// POST /api/ens/claim - mint <label>.gohealthme.eth for a wallet on ENSv2
// Sepolia.
//
// Gated exactly like the handle claim (app/api/social/handle/route.ts): the
// body names a wallet, and the EIP-191 signature in the headers must be from
// THAT wallet (requireAddressSignature). Only after the signature verifies
// does the owner key mint the subname. The participant signs nothing on
// Sepolia and needs no Sepolia ETH: the name token lands in their wallet with
// addr(60) pointing back at it, paid for by GoHealthMe.
//
// ENS is the source of truth. When Supabase is configured the handle profile
// is written afterwards as a cache (same label), and a cache failure never
// fails the claim.
//
// Request JSON:  { address, label }
// Response JSON: { name, tx, alreadyOwned } on success.

import type { Address } from "viem";
import { claimEnsName, liveClaimDeps } from "@/lib/server/ens/claim";
import { claimHandle } from "@/lib/server/social-profile";
import { supabaseWriteConfigured } from "@/lib/server/supabase";
import { requireAddressSignature } from "@/lib/server/wallet-auth";
import {
  jsonError,
  newCorrelationId,
  readJsonBody,
  safeError,
} from "@/lib/server/http";

// Two Sepolia transactions are awaited (register, then the address record).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cid = newCorrelationId("ens-claim");
  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      return jsonError(400, "Request body must be a JSON object.");
    }

    const { address, label } = body;
    if (typeof address !== "string" || address === "") {
      return jsonError(400, "address must be a 0x address string");
    }
    if (typeof label !== "string") {
      return jsonError(400, "label must be a string");
    }

    // The proof must be for THIS address, not merely some address.
    const auth = await requireAddressSignature(request, address);
    if (!auth.ok) {
      return jsonError(401, "Sign with the wallet you are claiming for.");
    }

    const deps = liveClaimDeps();
    if (supabaseWriteConfigured()) {
      deps.cacheProfile = async (wallet: Address, minted: string) => {
        const cached = await claimHandle({
          rawAddress: wallet,
          rawHandle: minted,
          rawEmoji: null,
          skipEns: true,
        });
        if (!cached.ok) {
          console.warn(`[${cid}] profile cache declined ${minted}: ${cached.reason}`);
        }
      };
    }

    const result = await claimEnsName({ address: auth.address, rawLabel: label }, deps);
    if (!result.ok) {
      return jsonError(result.status, result.reason);
    }
    return Response.json({
      name: result.name,
      tx: result.tx,
      alreadyOwned: result.alreadyOwned,
    });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
