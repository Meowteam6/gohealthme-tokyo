// POST /api/ens/link - use an ENS name the player already owns.
// DELETE /api/ens/link - forget it (the player goes back to their subname or
// short address).
//
// Signature-gated like the claim (requireAddressSignature on the body's
// address). The name is accepted only when it forward-resolves, on Ethereum
// mainnet or Sepolia, to the signing wallet (lib/server/ens/link.ts). With
// prove-human on, the wallet must be a verified human first, the same bar as
// the claim; with it off, nothing extra is asked.
//
// Request JSON:  POST { address, name }   DELETE { address }
// Response JSON: POST { name, chain }     DELETE { ok: true }

import { checkNameHuman } from "@/lib/server/ens/human-gate";
import { linkEnsName, liveLinkDeps, unlinkEnsName } from "@/lib/server/ens/link";
import { requireAddressSignature } from "@/lib/server/wallet-auth";
import {
  jsonError,
  newCorrelationId,
  readJsonBody,
  safeError,
} from "@/lib/server/http";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Signed =
  | { ok: true; address: string; body: Record<string, unknown> }
  | { ok: false; response: Response };

async function signedAddress(request: Request, verb: string): Promise<Signed> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch {
    return { ok: false, response: jsonError(400, "Request body must be a JSON object.") };
  }
  const { address } = body;
  if (typeof address !== "string" || address === "") {
    return { ok: false, response: jsonError(400, "address must be a 0x address string") };
  }
  const auth = await requireAddressSignature(request, address);
  if (!auth.ok) {
    return { ok: false, response: jsonError(401, `Sign with the wallet you are ${verb} for.`) };
  }
  return { ok: true, address: auth.address, body };
}

export async function POST(request: Request) {
  const cid = newCorrelationId("ens-link");
  try {
    const signed = await signedAddress(request, "linking");
    if (!signed.ok) return signed.response;
    const { name } = signed.body;
    if (typeof name !== "string" || name.trim() === "") {
      return jsonError(400, "name must be an ENS name");
    }
    const human = await checkNameHuman(signed.address);
    if (!human.ok) return jsonError(human.status, human.reason);

    const result = await linkEnsName({ address: signed.address, rawName: name }, liveLinkDeps());
    if (!result.ok) return jsonError(result.status, result.reason);
    return Response.json({ name: result.name, chain: result.chain });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}

export async function DELETE(request: Request) {
  const cid = newCorrelationId("ens-unlink");
  try {
    const signed = await signedAddress(request, "unlinking");
    if (!signed.ok) return signed.response;
    await unlinkEnsName(signed.address);
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
