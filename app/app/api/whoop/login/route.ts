// GET /api/whoop/login?ticket=<link ticket>&next=<in-app path, optional>
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
import { providerConfigured } from "@/lib/server/wearable";
import { readLinkTicket } from "@/lib/server/wearable/link-ticket";
import {
  DEFAULT_RETURN_PATH,
  safeReturnPath,
} from "@/lib/server/wearable/return-path";
import { buildAuthorizeUrl } from "@/lib/server/wearable/whoop";

/**
 * This route is reached by a top-level NAVIGATION from a button, so a failure
 * has to land the user back on a page they can use. Answering with a raw JSON
 * error page strands somebody who just tapped "Connect WHOOP" on a screen with
 * no navigation and deploy-engineer text on it. Same outcomes the callback
 * uses, so the dashboard already knows how to word them.
 */
function backToDashboard(
  request: NextRequest,
  outcome: string,
  returnPath: string = DEFAULT_RETURN_PATH,
): NextResponse {
  const target = new URL(returnPath, request.nextUrl.origin);
  target.searchParams.set("whoop", outcome);
  return NextResponse.redirect(target);
}

/** Scope of the nonce cookie: only the callback ever reads it. */
export const WHOOP_NONCE_COOKIE = "whoop_oauth_nonce";
/**
 * Where the flow returns to, carried beside the nonce. A player pairing from
 * character creation goes back there, not to a dashboard the onboarding gate
 * would cover. Validated on the way in AND on the way out (safeReturnPath).
 */
export const WHOOP_RETURN_COOKIE = "whoop_oauth_return";
const NONCE_TTL_SECONDS = 600;

export async function GET(request: NextRequest) {
  const returnPath =
    safeReturnPath(request.nextUrl.searchParams.get("next")) ??
    DEFAULT_RETURN_PATH;
  try {
    if (!providerConfigured("whoop")) {
      return backToDashboard(request, "unavailable", returnPath);
    }

    const ticket = request.nextUrl.searchParams.get("ticket");
    const address = ticket === null ? null : readLinkTicket(ticket);
    if (address === null) {
      // Deliberately one outcome for missing, malformed, tampered and expired.
      // Which of the four it was tells an attacker something and the user
      // nothing: their fix is the same either way.
      return backToDashboard(request, "expired", returnPath);
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
    response.cookies.set(WHOOP_RETURN_COOKIE, returnPath, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/api/whoop",
      maxAge: NONCE_TTL_SECONDS,
    });
    return response;
  } catch (err) {
    console.error("[whoop/login] failed", err);
    return backToDashboard(request, "failed", returnPath);
  }
}
