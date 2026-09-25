// Cookie names shared by /api/whoop/login (sets them) and /api/whoop/callback
// (reads and clears them). Kept out of the route files because a Next.js route
// module may export only route handlers and route config.

/** The OAuth nonce plus the ticket-verified address, `nonce:address`. */
export const WHOOP_NONCE_COOKIE = "whoop_oauth_nonce";

/**
 * Where the flow returns to, carried beside the nonce. Validated on the way
 * in and on the way out (safeReturnPath).
 */
export const WHOOP_RETURN_COOKIE = "whoop_oauth_return";
