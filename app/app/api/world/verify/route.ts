// POST /api/world/verify - prove this wallet belongs to one human.
//
// Request JSON: { address, proof }  where proof is the IDKit result payload
// exactly as the widget handed it to handleVerify (or, in event mode, the
// IDKit-shaped mock payload ProveHuman builds). Headers carry the EIP-191
// wallet signature (lib/server/wallet-auth.ts): the proof is bound to a
// wallet, so the caller must prove they hold that wallet, or anyone could
// bind a stolen payload to an address of their choosing.
//
// What happens, in order, and what each refusal means:
//   400  the body is not a wallet plus an IDKit-shaped proof
//   401  no or wrong wallet signature; or the proof did not check out
//        (wrong action, made for another wallet, rejected by World)
//   409  the binding rule refused it. Body carries `conflict`:
//          wallet-has-other-human   this wallet is already someone else's
//          human-has-other-wallet   this human already has a wallet; body
//                                   carries `otherWallet` so the UI can say
//                                   "sign in with the wallet you verified with"
//   502  World could not be reached or answered nonsense (live mode only)
//   503  prove-human is not enabled on this deployment, or the store is busy
//   200  { ok: true, nullifierHash, verifiedAt, mode, credential, created }
//
// Nothing about the person is stored beyond the wallet, the nullifier and
// the time. No health data ever touches this route.

import { isAddress } from "viem";
import { requireAddressSignature } from "@/lib/server/wallet-auth";
import { LockUnavailableError } from "@/lib/server/store";
import {
  playerWorldProblem,
  worldNamespace,
  worldSetup,
} from "@/lib/server/world/config";
import { bindHuman } from "@/lib/server/world/human";
import { parseIdkitPayload } from "@/lib/server/world/payload";
import { verifyLive, verifyMock } from "@/lib/server/world/verify";
import {
  jsonError,
  newCorrelationId,
  readJsonBody,
  safeError,
} from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const cid = newCorrelationId("world-verify");
  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch {
      return jsonError(400, "Request body must be a JSON object.");
    }

    const { address, proof } = body;
    if (typeof address !== "string" || !isAddress(address)) {
      return jsonError(400, "address must be a 0x address string");
    }
    const parsed = parseIdkitPayload(proof);
    if (!parsed.ok) {
      return jsonError(400, parsed.reason);
    }

    // The proof must be for THIS wallet and the caller must hold it.
    const auth = await requireAddressSignature(request, address);
    if (!auth.ok) {
      return jsonError(401, "Sign with the wallet you are verifying.");
    }

    const setup = worldSetup();
    if (setup.mode === "off") {
      // Player copy only; the operator detail (env names) goes to the log.
      return jsonError(503, playerWorldProblem(setup, cid));
    }

    const verified =
      setup.mode === "live" && setup.live !== null
        ? await verifyLive({
            proof: parsed.proof,
            address: auth.address,
            config: setup.live,
          })
        : verifyMock({
            proof: parsed.proof,
            address: auth.address,
            action: setup.action,
          });
    if (!verified.ok) {
      if (verified.code !== undefined) {
        console.error(`[${cid}] world verify refused: ${verified.code}`);
      }
      return jsonError(verified.status, verified.reason);
    }

    let bound;
    try {
      bound = await bindHuman({
        address: auth.address,
        nullifierHash: verified.nullifierHash,
        mode: setup.mode,
        protocolVersion: verified.protocolVersion,
        credential: verified.credential,
        // Bound where this deployment reads: a mock bind never lands where
        // live reads, and a staging bind never where production reads.
        namespace: worldNamespace(setup) ?? undefined,
      });
    } catch (err) {
      if (err instanceof LockUnavailableError) {
        return jsonError(503, "Busy right now; nothing was recorded. Try again.");
      }
      throw err;
    }
    if (!bound.ok) {
      return Response.json(
        {
          error: bound.reason,
          conflict: bound.conflict,
          ...(bound.otherWallet === undefined
            ? {}
            : { otherWallet: bound.otherWallet }),
        },
        { status: bound.status },
      );
    }

    return Response.json({
      ok: true,
      nullifierHash: bound.record.nullifierHash,
      verifiedAt: bound.record.verifiedAt,
      mode: bound.record.mode,
      credential: bound.record.credential ?? null,
      created: bound.created,
    });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
