// GET  /api/world/rp-context  - what the prove-human step needs to render.
// POST /api/world/rp-context  - the same, plus a freshly signed RP context.
//
// IDKit 4.x needs every request signed by the relying party with a key that
// lives ONLY on the server (docs.world.org/world-id/idkit/integrate: "Never
// generate RP signatures on the client"). signRequest from
// @worldcoin/idkit-core/signing mints a nonce, a created_at/expires_at
// window (300 s) and the EIP-191 signature over them and the action. The
// widget is opened with that object as `rp_context`.
//
// GET never mints: a page render must not burn signatures. POST is called
// when the person taps the button, so the context is fresh when the widget
// opens (an expired one fails inside World App as rp_signature_expired).
//
// Response JSON, by mode (lib/server/world/config.ts):
//   off   { mode: "off", problem: string }   (player copy, never env names)
//   mock  { mode: "mock", action }                 (event mode, proofs mocked)
//   live  { mode: "live", app_id, action, environment, rp_context? }
//         rp_context = { rp_id, nonce, created_at, expires_at, signature }
//         (POST only)

import { signRequest } from "@worldcoin/idkit-core/signing";
import { playerWorldProblem, worldSetup } from "@/lib/server/world/config";
import { jsonError, newCorrelationId, safeError } from "@/lib/server/http";

export const runtime = "nodejs";

function describe(mint: boolean, cid: string) {
  const setup = worldSetup();
  if (setup.mode === "off") {
    // Player copy only; the operator detail (env names) goes to the log.
    return { mode: "off" as const, problem: playerWorldProblem(setup, cid) };
  }
  if (setup.mode === "mock") {
    return { mode: "mock" as const, action: setup.action };
  }
  const live = setup.live;
  if (live === null) {
    // worldSetup guarantees live is set for mode "live"; keep the type honest.
    return {
      mode: "off" as const,
      problem: playerWorldProblem({ ...setup, problem: "live config missing" }, cid),
    };
  }
  const base = {
    mode: "live" as const,
    app_id: live.appId,
    action: live.action,
    environment: live.environment,
  };
  if (!mint) return base;
  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex: live.signingKeyHex,
    action: live.action,
  });
  return {
    ...base,
    rp_context: {
      rp_id: live.rpId,
      nonce,
      created_at: createdAt,
      expires_at: expiresAt,
      signature: sig,
    },
  };
}

export async function GET() {
  const cid = newCorrelationId("world-rp-context");
  try {
    return Response.json(describe(false, cid));
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}

export async function POST() {
  const cid = newCorrelationId("world-rp-context");
  try {
    return Response.json(describe(true, cid));
  } catch (err) {
    return jsonError(500, safeError(err, cid));
  }
}
