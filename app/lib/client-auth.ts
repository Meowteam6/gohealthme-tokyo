// Browser side of the wallet-signature proof that lib/server/wallet-auth.ts
// verifies.
//
// WHY THIS EXISTS: a goalId is not a capability. The public feed publishes
// them and pool participants are readable on chain, so possession of one
// proves nothing about who is asking. The only thing that separates the person
// whose medical document was judged from a stranger who copied their goal id
// is a signature from that wallet, and this module is where the browser
// produces one.
//
// WHY IT CACHES. The claim loop polls the run route every 800ms. A wallet
// prompt per poll would be unusable, so a signature is signed once and reused
// until it ages out. The credential lives in module memory only - never
// localStorage, never a cookie: it is a bearer credential for its whole
// lifetime, and one that dies with the tab cannot be lifted off disk later.
//
// WHY THE WINDOW IS SHORTER THAN THE SERVER'S. The server refuses anything
// older than ten minutes measured against ITS clock. Reusing a credential for
// the full ten would mean a browser whose clock runs slow starts getting 401s
// at the boundary; the margin below absorbs that. When a 401 arrives anyway,
// fetchWithWalletAuth drops the cached credential and signs once more rather
// than reporting a permission problem the user cannot act on.
//
// WHY THE MESSAGE IS MIRRORED, NOT IMPORTED: walletAuthMessage lives in
// lib/server/wallet-auth.ts, and server modules stay out of the client bundle
// (the same rule agent-receipt.ts and claim-restore.ts follow). The two
// renderings are pinned to each other by a test that imports both, so drift
// fails the suite rather than the login.

//
// THE SESSION TOKEN COMES FIRST. A player Dynamic has already authenticated
// holds a session token (a JWT) that lists every wallet they proved to it, and
// lib/server/dynamic-jwt.ts accepts that token instead of a signature. So
// before any prompt, getWalletAuth asks Dynamic for the token, decodes it
// WITHOUT trusting it (the server is what verifies), and, when it lists the
// connected wallet, sends `Authorization: Bearer <token>` plus the address
// header. No wallet prompt at all. A wallet with no token, as a connect-only
// external wallet may be, signs exactly as before. A token the server refuses
// is remembered and not sent again, so the 401 retry signs once instead of
// looping on the same token.

import { decodeJwt } from "jose";

export const WALLET_AUTH_ADDRESS_HEADER = "x-gohealthme-address";
export const WALLET_AUTH_TIMESTAMP_HEADER = "x-gohealthme-timestamp";
export const WALLET_AUTH_SIGNATURE_HEADER = "x-gohealthme-signature";
export const WALLET_AUTH_AUTHORIZATION_HEADER = "authorization";

/** Scope Dynamic grants once sign-in is complete (mirrors the server check). */
const SESSION_REQUIRED_SCOPE = "user:basic";

/** A token this close to expiry is not sent: it could expire in flight and
 *  turn a working read into a 401 plus a prompt. */
export const SESSION_TOKEN_EXPIRY_MARGIN_MS = 60 * 1000;

/** How long a signed credential is reused. The server allows ten minutes;
 *  the two-minute margin covers client clock drift and a slow request. */
export const CLIENT_WALLET_AUTH_TTL_MS = 8 * 60 * 1000;

/** Mirror of lib/server/wallet-auth.ts's walletAuthMessage. Wire format. */
export function clientWalletAuthMessage(
  address: string,
  isoTimestamp: string,
): string {
  return `GoHealthMe: prove control of ${address} at ${isoTimestamp}`;
}

export interface WalletAuthCredential {
  address: string;
  timestamp: string;
  signature: string;
}

/** The three headers the server reads. */
export function authHeadersOf(
  credential: WalletAuthCredential,
): Record<string, string> {
  return {
    [WALLET_AUTH_ADDRESS_HEADER]: credential.address,
    [WALLET_AUTH_TIMESTAMP_HEADER]: credential.timestamp,
    [WALLET_AUTH_SIGNATURE_HEADER]: credential.signature,
  };
}

/**
 * Whether a cached credential may still be sent for `address`. Address match
 * is case-insensitive because the connected wallet and the cache may hold
 * different renderings of the same account; freshness is measured from the
 * moment it was signed. A credential signed in the future (the clock moved
 * backwards mid-session) is treated as unusable rather than as valid forever.
 */
export function credentialUsableAt(
  credential: WalletAuthCredential,
  address: string,
  nowMs: number,
): boolean {
  if (credential.address.toLowerCase() !== address.toLowerCase()) return false;
  const signedAtMs = Date.parse(credential.timestamp);
  if (!Number.isFinite(signedAtMs)) return false;
  const ageMs = nowMs - signedAtMs;
  return ageMs >= 0 && ageMs < CLIENT_WALLET_AUTH_TTL_MS;
}

/**
 * Whether a Dynamic session token is worth sending for `address`: it lists the
 * wallet as a blockchain credential, its sign-in is complete (user:basic), and
 * it is not about to expire. Decoded, not verified: this only decides whether
 * to try the token, and a wrong answer costs one 401 and a signature, never
 * access. The server re-checks all of it against Dynamic's keys.
 */
export function sessionTokenCoversAddress(
  token: string,
  address: string,
  nowMs: number,
): boolean {
  let payload: ReturnType<typeof decodeJwt>;
  try {
    payload = decodeJwt(token);
  } catch {
    return false;
  }
  if (typeof payload.exp !== "number") return false;
  if (payload.exp * 1000 - nowMs <= SESSION_TOKEN_EXPIRY_MARGIN_MS) return false;
  if (
    typeof payload.scope !== "string" ||
    !payload.scope.split(/\s+/).includes(SESSION_REQUIRED_SCOPE)
  ) {
    return false;
  }
  const credentials = payload.verified_credentials;
  if (!Array.isArray(credentials)) return false;
  const wanted = address.toLowerCase();
  return credentials.some((credential: unknown) => {
    if (typeof credential !== "object" || credential === null) return false;
    const { format, address: listed } = credential as {
      format?: unknown;
      address?: unknown;
    };
    return (
      format === "blockchain" &&
      typeof listed === "string" &&
      listed.toLowerCase() === wanted
    );
  });
}

/** The two headers the server reads on the session-token path. */
export function sessionAuthHeaders(
  token: string,
  address: string,
): Record<string, string> {
  return {
    [WALLET_AUTH_AUTHORIZATION_HEADER]: `Bearer ${token}`,
    [WALLET_AUTH_ADDRESS_HEADER]: address,
  };
}

export type ClientAuth =
  /** Proven and fresh; `headers` goes straight onto a fetch. `credential` is
   *  the signature when one was used, and null when the headers carry the
   *  Dynamic session token instead. */
  | {
      kind: "ok";
      credential: WalletAuthCredential | null;
      headers: Record<string, string>;
    }
  /** No wallet connected, so there is nobody to prove control of. */
  | { kind: "no-wallet" }
  /** Nothing cached and the caller asked not to prompt. Browse surfaces read
   *  this way: a page nobody asked to unlock must not throw up a wallet
   *  modal, so it reads what it can and says the rest is behind a signature. */
  | { kind: "unsigned" }
  /** The user saw the prompt and said no. */
  | { kind: "declined" }
  /** The signer failed for some other reason (wrong network, SDK error). */
  | { kind: "failed"; message: string };

/**
 * User-facing sentence for an auth attempt that produced no credential. Lives
 * here so every surface says the same true thing, and so the wording is
 * testable in node alongside the branch that selects it. Returns null for a
 * successful attempt.
 */
export function authBlockReason(auth: ClientAuth): string | null {
  switch (auth.kind) {
    case "ok":
      return null;
    case "no-wallet":
      return "Connect your wallet to see this claim. It is private to the wallet that made it.";
    case "unsigned":
      return "This is private to your wallet. Sign to unlock it - nothing is charged and no transaction is sent.";
    case "declined":
      return "This claim is private to your wallet, so it stays hidden until you sign. Nothing is charged and no transaction is sent - the signature only proves the wallet is yours.";
    case "failed":
      return `Your wallet could not sign the proof of ownership: ${auth.message}`;
  }
}

/** viem, Dynamic and injected wallets all report a refused prompt differently.
 *  Rejection is not an error to report as a failure - it is a choice, and the
 *  copy for it is different - so it is classified rather than lumped in. */
export function isUserRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as { name?: unknown; code?: unknown; message?: unknown };
  if (candidate.code === 4001) return true;
  if (
    typeof candidate.name === "string" &&
    /UserRejected|UserDenied/i.test(candidate.name)
  ) {
    return true;
  }
  return (
    typeof candidate.message === "string" &&
    /user (rejected|denied)|rejected the request|denied (the )?(message|signature)/i.test(
      candidate.message,
    )
  );
}

export type SignMessageFn = (message: string) => Promise<string>;

/** Reads Dynamic's session token (getAuthToken); undefined when signed out. */
export type SessionTokenFn = () => string | null | undefined;

// ------------------------------------------------------------------ the cache
//
// Keyed by lower-cased address so a wallet switch cannot serve the previous
// wallet's credential. In-flight promises are shared per address: three
// components mounting at once (pool page, claim client, dashboard) must
// produce ONE prompt, not three.

const credentials = new Map<string, WalletAuthCredential>();
const inflight = new Map<string, Promise<ClientAuth>>();

// Session tokens the server refused (a refresh was asked for while the token
// was the thing being sent). Never sent again; the wallet signs instead. A
// token Dynamic rotates in is a different string and gets its own try. Bounded
// because a tab could in principle see many rotations.
const refusedSessionTokens = new Set<string>();
const MAX_REFUSED_SESSION_TOKENS = 8;

/** Set aside the session token an auth result carried, if it carried one. */
function refuseSessionTokenIn(auth: ClientAuth): void {
  if (auth.kind !== "ok" || auth.credential !== null) return;
  const header = auth.headers[WALLET_AUTH_AUTHORIZATION_HEADER] ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (token === "") return;
  refusedSessionTokens.add(token);
  if (refusedSessionTokens.size > MAX_REFUSED_SESSION_TOKENS) {
    const oldest = refusedSessionTokens.values().next().value;
    if (oldest !== undefined) refusedSessionTokens.delete(oldest);
  }
}

/** Dynamic's token, or null. Reading it must never break the signing path. */
function readSessionToken(
  getSessionToken: SessionTokenFn | null | undefined,
): string | null {
  if (getSessionToken === null || getSessionToken === undefined) return null;
  try {
    const token = getSessionToken();
    return typeof token === "string" && token.trim() !== "" ? token.trim() : null;
  } catch {
    return null;
  }
}

/** Test seam and wallet-switch cleanup. Omit the address to drop everything. */
export function clearWalletAuth(address?: string): void {
  if (address === undefined) {
    credentials.clear();
    inflight.clear();
    refusedSessionTokens.clear();
    return;
  }
  const key = address.toLowerCase();
  credentials.delete(key);
  inflight.delete(key);
}

/** The cached credential for an address, or null when absent or stale. */
export function cachedWalletAuth(
  address: string,
  nowMs: number = Date.now(),
): WalletAuthCredential | null {
  const credential = credentials.get(address.toLowerCase());
  if (credential === undefined) return null;
  if (!credentialUsableAt(credential, address, nowMs)) {
    credentials.delete(address.toLowerCase());
    return null;
  }
  return credential;
}

function ok(credential: WalletAuthCredential): ClientAuth {
  return { kind: "ok", credential, headers: authHeadersOf(credential) };
}

/**
 * Produce (or reuse) proof of control of `address`: the Dynamic session token
 * when it covers the wallet, otherwise a signature.
 *
 * Never throws: a declined prompt and a broken signer are states the UI has to
 * render, not exceptions to escape into a render. `refresh` forces a new
 * signature, which is what a 401 on a cached credential calls for; a token
 * the server refused has already been set aside by the fetch that saw the
 * 401, so the same refresh signs instead of resending it.
 */
export async function getWalletAuth(params: {
  address: string | null;
  signMessage: SignMessageFn | null;
  refresh?: boolean;
  /** Use a cached credential if there is one, but never open a wallet prompt.
   *  For surfaces the user did not ask to unlock. A session token that covers
   *  the wallet counts as cached. */
  cachedOnly?: boolean;
  /** Dynamic's getAuthToken. Omitted or null means signatures only. */
  getSessionToken?: SessionTokenFn | null;
  now?: () => number;
}): Promise<ClientAuth> {
  const { address, signMessage } = params;
  const now = params.now ?? Date.now;
  if (address === null || signMessage === null) return { kind: "no-wallet" };

  const key = address.toLowerCase();
  if (params.refresh === true) clearWalletAuth(address);

  // A refresh does NOT discard the session token: "Check my wearable" asks for
  // one because the player tapped, and a good token must not turn that tap
  // into a prompt. Only a 401 against the token itself (fetchWithWalletAuth,
  // walletAuthFetch) marks it refused.
  const sessionToken = readSessionToken(params.getSessionToken);
  if (
    sessionToken !== null &&
    !refusedSessionTokens.has(sessionToken) &&
    sessionTokenCoversAddress(sessionToken, address, now())
  ) {
    return {
      kind: "ok",
      credential: null,
      headers: sessionAuthHeaders(sessionToken, address),
    };
  }

  const cached = cachedWalletAuth(address, now());
  if (cached !== null) return ok(cached);

  const pending = inflight.get(key);
  if (pending !== undefined) return pending;

  // A prompt already in flight is shared above; only a genuinely absent
  // credential stops here, so a cached-only reader still benefits from a
  // signature another surface is in the middle of collecting.
  if (params.cachedOnly === true) return { kind: "unsigned" };

  const attempt = (async (): Promise<ClientAuth> => {
    const timestamp = new Date(now()).toISOString();
    try {
      const signature = await signMessage(
        clientWalletAuthMessage(address, timestamp),
      );
      if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
        return {
          kind: "failed",
          message: "the wallet returned a signature this app cannot use",
        };
      }
      const credential: WalletAuthCredential = {
        address,
        timestamp,
        signature,
      };
      credentials.set(key, credential);
      return ok(credential);
    } catch (err) {
      if (isUserRejection(err)) return { kind: "declined" };
      return {
        kind: "failed",
        message:
          err instanceof Error && err.message !== ""
            ? err.message
            : "the wallet could not sign",
      };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, attempt);
  return attempt;
}

// -------------------------------------------------------------- signed fetch

export type WalletAuthRequester = (options?: {
  refresh?: boolean;
  cachedOnly?: boolean;
}) => Promise<ClientAuth>;

export interface WalletAuthFetchResult {
  response: Response;
  /** The auth state the final request was made under. "ok" means the headers
   *  were attached; anything else means the server saw an unsigned request and
   *  the caller must render the reduced answer honestly. */
  auth: ClientAuth;
}

/**
 * Fetch with the wallet headers attached when a signature is available.
 *
 * Deliberately still sends the request when there is no signature: the routes
 * answer an unsigned caller with a redacted projection, and that answer is
 * what lets the UI say "a claim exists, sign to see it" instead of showing a
 * blank box. A 401 against a credential that WAS attached means the cached
 * signature aged past the server's window, so it is dropped and re-signed once
 * - a stale cache must never look like a permission failure. A 401 against a
 * session token sets that token aside first, so the one retry is a signature
 * and never the same token again: no loop, and nobody locked out.
 */
export async function fetchWithWalletAuth(
  url: string,
  init: RequestInit | undefined,
  requestAuth: WalletAuthRequester,
  fetchImpl: typeof fetch = fetch,
): Promise<WalletAuthFetchResult> {
  const auth = await requestAuth();
  const send = (current: ClientAuth) => {
    const headers = new Headers(init?.headers);
    if (current.kind === "ok") {
      for (const [name, value] of Object.entries(current.headers)) {
        headers.set(name, value);
      }
    }
    return fetchImpl(url, { ...init, headers });
  };

  const response = await send(auth);
  if (response.status !== 401 || auth.kind !== "ok") {
    return { response, auth };
  }

  refuseSessionTokenIn(auth);
  const retryAuth = await requestAuth({ refresh: true });
  if (retryAuth.kind !== "ok") return { response, auth: retryAuth };
  return { response: await send(retryAuth), auth: retryAuth };
}

// ------------------------------------------------- third-party fetch wrapping
//
// A third-party SDK may take ONE customFetch and use it for both our own API
// routes and its own host. The credential proves control of a wallet, so it
// goes to our origin and nowhere else - handing it to a third party would be
// handing over a bearer token.

/** True only for a request back to this app: a relative path, or an absolute
 *  URL whose origin matches. Anything unparseable is treated as foreign. */
export function shouldAttachWalletAuth(url: string, origin: string): boolean {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("//")) return true;
  try {
    return new URL(url, origin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/** The URL a fetch argument addresses, for the same-origin decision. */
export function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * A fetch that attaches the wallet headers to same-origin requests only.
 * Handed to a third-party SDK as its customFetch so the SDK's own calls to our
 * routes carry the proof, while its external traffic stays clean.
 *
 * The credential is resolved per request, not captured once: a long-lived SDK
 * client outlives a ten minute window, so a frozen credential would work at
 * derive time and 401 later. `requestAuth` is cached, so this costs nothing
 * until it expires.
 */
export function walletAuthFetch(
  requestAuth: WalletAuthRequester,
  origin: string,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!shouldAttachWalletAuth(fetchInputUrl(input), origin)) {
      return fetchImpl(input, init);
    }
    const auth = await requestAuth();
    // An unsigned request is sent as-is and the route answers 401: the SDK
    // surfaces that as a failure, which is the loud direction for a money
    // path. Silently dropping the call would look like a hung UI.
    const headers = auth.kind === "ok" ? auth.headers : {};
    let response: Response;
    if (typeof input === "string" || input instanceof URL) {
      const merged = new Headers(init?.headers);
      for (const [name, value] of Object.entries(headers)) {
        merged.set(name, value);
      }
      response = await fetchImpl(input, { ...init, headers: merged });
    } else {
      // A Request carries its own headers; merge rather than replace, or the
      // SDK's content-type and accept headers are lost with the body.
      const merged = new Headers(input.headers);
      for (const [name, value] of Object.entries(headers)) {
        merged.set(name, value);
      }
      response = await fetchImpl(new Request(input, { headers: merged }), init);
    }
    // No retry here (the SDK owns the body), but a refused session token is
    // set aside so the SDK's next call signs instead of repeating it.
    if (response.status === 401) refuseSessionTokenIn(auth);
    return response;
  };
}
