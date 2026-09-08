// GET /api/whoop/login?ticket=<link ticket>
// Starts the WHOOP OAuth flow and redirects to WHOOP's consent screen.
//
// The browser arrives here by top-level navigation, so there are no auth
// headers to check. The ticket is what carries the proof instead: it was
// minted by /api/wearable/link only after a wallet signature verified, and it
// names the address this grant will be bound to. Nothing else is accepted -
// taking an `address` query param here is what would let anyone attach their
// own WHOOP account to a stranger's wallet.
//
// CSRF is handled with the classic OAuth pairing: a random nonce goes into the
// `state` and into an httpOnly cookie, and the callback only proceeds when the
// two agree. The ticket proves who asked; the nonce proves the response came
// back to the same browser that asked.
//
// THE ADDRESS TRAVELS IN THE COOKIE, NOT IN `state`. `state` is echoed back by
// WHOOP through a URL the caller can retype, so anything in it is
// caller-controlled by the time the callback reads it. An earlier version put
// `nonce:address` in `state` and checked only the nonce half against the
// cookie: an attacker could complete a genuine consent for their OWN WHOOP
// account, then hand-craft the callback URL with their real nonce and a
// VICTIM's address, and we would bind their tokens to that wallet. That is one
// WHOOP account backing any number of wallets, and it silently overwrites the
// victim's real connection.
//
// The ticket is deliberately NOT put in `state` either. It is a bearer token
// that authorizes address binding, and `state` reaches WHOOP's request logs
// and any referrer along the way.

import { randomBytes } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { jsonError } from "@/lib/server/http";
import { providerConfigured } from "@/lib/server/wearable";
import { readLinkTicket } from "@/lib/server/wearable/link-ticket";
import { buildAuthorizeUrl } from "@/lib/server/wearable/whoop";

/** Scope of the nonce cookie: only the callback ever reads it. */
export const WHOOP_NONCE_COOKIE = "whoop_oauth_nonce";
const NONCE_TTL_SECONDS = 600;

export async function GET(request: NextRequest) {
  try {
    if (!providerConfigured("whoop")) {
      return jsonError(
        503,
        "The WHOOP connection is not available on this deployment.",
      );
    }

    const ticket = request.nextUrl.searchParams.get("ticket");
    const address = ticket === null ? null : readLinkTicket(ticket);
    if (address === null) {
      // Deliberately one message for missing, malformed, tampered and expired.
      // Which of the four it was tells an attacker something and the user
      // nothing: their fix is the same either way.
      return jsonError(
        400,
        "This connection link is no longer valid. Start again from the dashboard.",
      );
    }

    const nonce = randomBytes(16).toString("hex");
    // WHOOP requires at least 8 characters of state; 32 hex clears it on its
    // own, so the address does not need to ride along and must not.
    const state = nonce;

    const response = NextResponse.redirect(buildAuthorizeUrl(state));
    // httpOnly, so the page cannot read or forge it, and the address inside it
    // is the one readLinkTicket verified above.
    response.cookies.set(WHOOP_NONCE_COOKIE, `${nonce}:${address}`, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/api/whoop",
      maxAge: NONCE_TTL_SECONDS,
    });
    return response;
  } catch (err) {
    console.error("[whoop/login] failed", err);
    return jsonError(502, "Could not start the WHOOP connection right now");
  }
}
