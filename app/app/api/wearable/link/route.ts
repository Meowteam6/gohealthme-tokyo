// POST /api/wearable/link
// Body: { address, provider? }
// Returns: { provider, linkUrl } — open linkUrl to connect a device.
//
// Replaces /api/junction/link, and now covers both paths:
//   junction  linkUrl is Junction's hosted connect page
//   whoop     linkUrl is this app's own /api/whoop/login, which redirects on
//             to WHOOP's consent screen
//
// AUTH, and why this route gained it. The Junction version was
// unauthenticated, which was survivable there: creating a Junction user for
// somebody else's address only ever made an empty record. A WHOOP grant is a
// live credential, so an unauthenticated start would let anyone attach their
// own WHOOP account to a stranger's wallet — overwriting that person's real
// connection and pointing someone else's sleep data at a wallet that gets
// paid. The signature is checked here, and the address is then carried through
// the OAuth redirect as a short-lived ticket (see lib/server/wearable/
// link-ticket.ts), because a top-level navigation cannot send auth headers.

import { isAddress } from "viem";
import { errorMessage, jsonError, readJsonBody } from "@/lib/server/http";
import { requireAddressSignature } from "@/lib/server/wallet-auth";
import {
  isProviderId,
  PROVIDER_IDS,
  providerById,
  providerConfigured,
  providerIdFor,
  setProviderId,
} from "@/lib/server/wearable";
import { mintLinkTicket } from "@/lib/server/wearable/link-ticket";

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch (err) {
      return jsonError(400, errorMessage(err));
    }

    const { address, provider: requested } = body;
    if (typeof address !== "string" || !isAddress(address)) {
      return jsonError(400, "address must be a valid 0x address");
    }

    const auth = await requireAddressSignature(request, address);
    if (!auth.ok) {
      return jsonError(401, `Wallet signature required: ${auth.reason}`);
    }

    if (requested !== undefined && !isProviderId(requested)) {
      return jsonError(
        400,
        `provider must be one of: ${PROVIDER_IDS.join(", ")}`,
      );
    }

    const providerId = isProviderId(requested)
      ? requested
      : await providerIdFor(address);

    if (!providerConfigured(providerId)) {
      // A configuration gap, reported as one. Telling the user to try again
      // would be a lie: nothing they can do fixes a missing server credential.
      return jsonError(
        503,
        `The ${providerId} connection is not available on this deployment.`,
      );
    }

    // Recorded BEFORE the redirect, so the callback and every later background
    // verification read the same provider the user is about to link. A choice
    // written only on success would leave a user who abandons the consent
    // screen pointed at the other provider.
    await setProviderId(address, providerId);

    if (providerId === "whoop") {
      const ticket = mintLinkTicket(address);
      return Response.json({
        provider: providerId,
        kind: "oauth",
        linkUrl: `/api/whoop/login?ticket=${encodeURIComponent(ticket)}`,
      });
    }

    const link = await providerById(providerId).startLink(address);
    // The shape is passed through rather than flattened: a provider that can
    // only be linked on a phone (Apple Health has no web OAuth) has to reach
    // the browser as something other than "a URL to open", or the connect
    // button silently does nothing for it.
    return Response.json({ provider: providerId, ...link });
  } catch (err) {
    console.error("[wearable/link] failed", err);
    return jsonError(502, "Could not start the device connection right now");
  }
}
