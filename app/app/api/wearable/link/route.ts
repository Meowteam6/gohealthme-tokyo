// POST /api/wearable/link
// Body: { address, provider?, next? }   next: in-app path WHOOP returns to
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

import { whoopAllowedFor } from "@/lib/server/wearable/whoop-allowlist";
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
import { safeReturnPath } from "@/lib/server/wearable/return-path";

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

    const storedOrRequested = isProviderId(requested)
      ? requested
      : await providerIdFor(address);
    // A wallet whose stored choice is WHOOP but who may not pair WHOOP any
    // more (removed from the allowlist, link since lost) must not loop on a
    // 403 that says "use Junction": with no explicit choice, fall back to
    // Junction. An explicit request for WHOOP still gets the plain 403 below.
    const providerId =
      !isProviderId(requested) && storedOrRequested === "whoop" && !whoopAllowedFor(address)
        ? "junction"
        : storedOrRequested;

    if (!providerConfigured(providerId)) {
      // A configuration gap, reported as one. Telling the user to try again
      // would be a lie: nothing they can do fixes a missing server credential.
      // Named by label, not by internal id, and without "on this deployment",
      // which is deploy-engineer language for somebody who just tapped a
      // button. Still honest that waiting will not fix it.
      return jsonError(
        503,
        `${providerById(providerId).label} cannot be connected right now. ` +
          "This is a setup problem on our side, not something you can retry.",
      );
    }

    if (providerId === "whoop") {
      // WHOOP's sandbox app is capped at 10 members, so direct WHOOP pairing
      // is allowlisted; everyone else pairs through Junction.
      if (!whoopAllowedFor(address)) {
        return jsonError(
          403,
          "WHOOP pairing is in private beta. Pair through Junction instead; it covers WHOOP straps too.",
        );
      }
      // NOT recorded here. WHOOP's flow has a callback that records the choice
      // only once tokens are actually stored, and writing it up front means a
      // user who opens WHOOP's consent screen and backs out has silently
      // switched providers: their working Junction connection stops backing
      // their claims and the dashboard tells them to connect a device they
      // already have. Abandoning a flow must change nothing.
      const ticket = mintLinkTicket(address);
      // The page the connect started on, so WHOOP's redirect comes back there
      // (character creation, a pool) instead of a dashboard the onboarding
      // gate covers. Validated here and again at /login and /callback.
      const returnPath = safeReturnPath(body.next);
      const nextParam =
        returnPath === null ? "" : `&next=${encodeURIComponent(returnPath)}`;
      return Response.json({
        provider: providerId,
        kind: "oauth",
        linkUrl: `/api/whoop/login?ticket=${encodeURIComponent(ticket)}${nextParam}`,
      });
    }

    const provider = providerById(providerId);

    // WHEN THE CHOICE IS RECORDED DEPENDS ON WHETHER ANYTHING CAN CONFIRM IT,
    // and the provider declares which it is, so the decision is made BEFORE
    // the link starts rather than after.
    //
    // An oauth link ends at a consent page: recorded first, so a user who
    // abandons that page is still pointed where they picked. Junction in
    // particular has no callback of ours to land on - its hosted page cannot
    // report back, and an unrecorded choice would leave a successful link
    // pointing at the wrong provider.
    //
    // An app link confirms nothing. Recording on the tap would switch a wallet
    // with a WORKING provider to one holding no data, because somebody read a
    // sentence and closed the tab.
    if (provider.linkKind === "oauth") {
      await setProviderId(address, providerId);
    }

    const link = await provider.startLink(address);

    // linkKind and the returned kind are two declarations of one fact, and the
    // branch above already acted on the first. A provider that declares
    // "oauth" and returns "app" would have had its choice written on a link
    // that confirms nothing - silently reintroducing the abandoned-tap bug for
    // the NEXT provider rather than an existing one. Not recoverable here (the
    // write already happened), so it is made loud instead of guessed at.
    if (link.kind !== provider.linkKind) {
      console.error(
        `[wearable/link] ${providerId} declares linkKind ` +
          `${provider.linkKind} but startLink returned ${link.kind}; the ` +
          "provider choice may have been recorded on a link that confirms nothing",
      );
    }
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
