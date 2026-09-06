// GET /api/proof/status - which proof paths SPOTTER can verify right now.
// Public, unauthenticated, no user data: it is the server's own configuration
// truth, read by the pools list, the create form and the pool page so a
// document pool is never offered while the verifier is off.

import { documentProofStatus } from "@/lib/server/proof-status";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(
    {
      document: documentProofStatus(),
      // Wearable goals are provider-attested through Junction and need no
      // verifier of ours; the pool page still checks the provider itself.
      wearable: { available: true },
    },
    { headers: { "cache-control": "public, max-age=60" } },
  );
}
