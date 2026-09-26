// POST /api/challenges/invite-token - hand a challenge's private /c/<token>
// invite link back to the wallet that CREATED it, so the creator can re-share
// from the pool page without the token ever being exposed to anyone else.
//
// This is the read counterpart to POST /api/challenges (which mints the link at
// creation). The token gates the /c/<token> landing, and pool ids are
// sequential and walkable, so the token must never appear on a public or
// unauthenticated path. The exact same two proofs the create route uses gate
// this read:
//   1. An EIP-191 signature proving the caller controls `address`
//      (requireAddressSignature).
//   2. An on-chain read proving that address is the pool's creator. Only then
//      is the token returned.
//
// Request JSON: { address, poolId }
// Response JSON: { inviteToken, sharePath } on success.

import { getAddress } from "viem";
import { fetchPool } from "@/lib/contract";
import { poolCanPay } from "@/lib/pool-lifecycle";
import {
  createChallenge,
  getInviteTokenByPoolId,
} from "@/lib/server/challenges";
import { requireAddressSignature } from "@/lib/server/wallet-auth";
import { isAllowed } from "@/lib/server/access";
import {
  jsonError,
  newCorrelationId,
  readJsonBody,
  safeError,
} from "@/lib/server/http";

/** Parse a pool id from the JSON body (number or decimal string) into a
 *  positive bigint, or null when it is not a usable id. */
function parsePoolId(raw: unknown): bigint | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return BigInt(raw);
  }
  if (typeof raw === "string" && /^[0-9]+$/.test(raw.trim())) {
    const value = BigInt(raw.trim());
    return value > 0n ? value : null;
  }
  return null;
}

export async function POST(request: Request) {
  const cid = newCorrelationId("challenges-invite-token");
  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      return jsonError(400, "Request body must be a JSON object.");
    }

    const { address, poolId } = body;
    if (typeof address !== "string" || address === "") {
      return jsonError(400, "address must be a 0x address string");
    }
    const poolIdValue = parsePoolId(poolId);
    if (poolIdValue === null) {
      return jsonError(400, "poolId must be a positive integer");
    }

    // Proof 1: the signature must be for THIS address.
    const auth = await requireAddressSignature(request, address);
    if (!auth.ok) {
      return jsonError(401, "Sign with the wallet that created this challenge.");
    }

    // Closed-beta gate. Fails closed.
    if (!(await isAllowed(auth.address))) {
      return jsonError(
        403,
        "This wallet is not in the GoHealthMe closed beta yet.",
      );
    }

    // Proof 2: that address must be the pool's on-chain creator.
    let creator: string;
    let canPay: boolean;
    try {
      const pool = await fetchPool(poolIdValue);
      creator = getAddress(pool.creator);
      canPay = poolCanPay(pool);
    } catch {
      return jsonError(404, "That challenge could not be found on Base.");
    }
    if (creator !== auth.address) {
      return jsonError(
        403,
        "Only the wallet that created this challenge can get its invite link.",
      );
    }

    // Read the existing invite token. Pools made through the dare flow already
    // have one; a challenge pool created another way does not, so mint one now
    // for the verified creator - the same write POST /api/challenges does, under
    // the same two proofs. unique(pool_id) makes a concurrent double-mint safe:
    // the loser conflicts and we re-read the winner's token.
    let inviteToken = await getInviteTokenByPoolId(poolIdValue);
    if (inviteToken === null) {
      if (!canPay) {
        return jsonError(
          409,
          "This challenge has ended, so there is no invite link to share.",
        );
      }
      const created = await createChallenge({
        rawChallengerAddress: auth.address,
        poolId: poolIdValue,
        rawTargetHandle: null,
        rawMessage: null,
      });
      if (created.ok) {
        inviteToken = created.challenge.inviteToken;
      } else if (created.status === 409) {
        inviteToken = await getInviteTokenByPoolId(poolIdValue);
      }
      if (inviteToken === null) {
        return jsonError(
          created.ok ? 500 : created.status,
          created.ok
            ? "Could not create an invite link."
            : created.reason,
        );
      }
    }

    return Response.json({ inviteToken, sharePath: `/c/${inviteToken}` });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
