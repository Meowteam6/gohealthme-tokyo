// GET /api/whoop/callback?code=...&state=<nonce>:<address>
// WHOOP's registered redirect target. Exchanges the authorization code for
// tokens, stores them encrypted against the wallet, and returns the user to
// the dashboard.
//
// This route is reached by a redirect from WHOOP, so every check it can make
// is made on what the redirect carries:
//   - `state` must match the httpOnly nonce cookie this browser was given at
//     /api/whoop/login. That is the CSRF check: without it, an attacker could
//     feed their own authorization code to a logged-in victim's browser and
//     bind their WHOOP account to the victim's wallet.
//   - the address comes out of `state`, which was built from a signed link
//     ticket. It is never read from a query param.
//
// Failures land the user back on the dashboard with a reason in the URL rather
// than on a JSON error page: they came from a normal in-app click and the way
// out is a normal in-app screen. The real cause is logged server-side.

import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";
import { setProviderId } from "@/lib/server/wearable";
import { writeTokens } from "@/lib/server/wearable/tokens";
import { exchangeCode } from "@/lib/server/wearable/whoop";
import { WHOOP_NONCE_COOKIE } from "@/app/api/whoop/login/route";

function backToDashboard(
  request: NextRequest,
  params: Record<string, string>,
): NextResponse {
  const target = new URL("/dashboard", request.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(target);
  response.cookies.delete(WHOOP_NONCE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  try {
    const denied = params.get("error");
    if (denied !== null) {
      // The user declining on WHOOP's screen is a normal outcome, not a fault.
      console.warn(`[whoop/callback] authorization declined: ${denied}`);
      return backToDashboard(request, { whoop: "declined" });
    }

    const code = params.get("code");
    const state = params.get("state");
    if (code === null || state === null) {
      return backToDashboard(request, { whoop: "failed" });
    }

    const separator = state.indexOf(":");
    const nonce = separator === -1 ? "" : state.slice(0, separator);
    const address = separator === -1 ? "" : state.slice(separator + 1);
    if (nonce === "" || !isAddress(address)) {
      console.warn("[whoop/callback] malformed OAuth state");
      return backToDashboard(request, { whoop: "failed" });
    }

    const cookieNonce = request.cookies.get(WHOOP_NONCE_COOKIE)?.value;
    if (cookieNonce === undefined || cookieNonce !== nonce) {
      console.warn("[whoop/callback] OAuth state did not match the nonce cookie");
      return backToDashboard(request, { whoop: "expired" });
    }

    const tokens = await exchangeCode(code);
    await writeTokens("whoop", address, tokens);
    // The link route already recorded the choice; re-asserting it here covers
    // a user who reached WHOOP's screen through some other entry point.
    await setProviderId(address, "whoop");

    return backToDashboard(request, { whoop: "connected" });
  } catch (err) {
    console.error("[whoop/callback] token exchange failed", err);
    return backToDashboard(request, { whoop: "failed" });
  }
}
