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
// CSRF is handled separately from that, with the classic OAuth pairing: a
// random nonce goes into the `state` and into an httpOnly cookie, and the
// callback only proceeds when the two agree. The ticket proves who asked; the
// nonce proves the response came back to the same browser that asked.

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
    // WHOOP requires at least 8 characters of state; this is 32 + 1 + 42.
    const state = `${nonce}:${address}`;

    const response = NextResponse.redirect(buildAuthorizeUrl(state));
    response.cookies.set(WHOOP_NONCE_COOKIE, nonce, {
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
