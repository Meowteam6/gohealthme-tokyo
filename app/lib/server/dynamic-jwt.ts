// Proof that the caller controls a wallet address, from the Dynamic session
// token (a JWT) the player already holds.
//
// WHY THIS EXISTS: lib/server/wallet-auth.ts proves wallet control with an
// EIP-191 signature, and the browser can only reuse one for eight minutes. A
// player moving through the lobby, the run and the verdict was therefore asked
// to sign again and again for reads of their own data. Dynamic has already
// authenticated that player and issued a signed session token naming every
// wallet they proved to it, so for them a second proof is redundant: this
// module accepts that token in place of the signature.
//
// WHAT IS CHECKED, all of it, or the token is refused:
//   1. The signature, against the environment's JWKS at
//      https://app.dynamicauth.com/api/v0/sdk/<environment id>/.well-known/jwks
//      (asymmetric algorithms only; keys are cached and refetched when an
//      unknown `kid` arrives, which is how Dynamic key rotation lands).
//   2. `exp` is present and in the future.
//   3. `scope` (space-separated) contains `user:basic`. Without it the login is
//      incomplete, for example an MFA step is still pending, and the token must
//      not stand in for wallet control.
//   4. `environment_id` equals NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID. If a token
//      carries no environment_id, its `iss` must end in "/<environment id>".
//   5. `verified_credentials` lists the claimed address as a `blockchain`
//      credential (case-insensitive). The address itself arrives in the
//      x-gohealthme-address header, so a token for wallet A never vouches
//      for wallet B.
//
// WHY THE SIGNATURE STAYS: the app runs Dynamic with
// initialAuthenticationMode "connect-only" (load-bearing, see
// app/providers.tsx), so a player who only connected an external wallet may
// hold no token at all. They keep signing exactly as before. Nobody who could
// authenticate yesterday is locked out today.
//
// A token is a bearer credential for its whole lifetime, which is longer than
// a signature's ten minutes. It already lives in the browser (Dynamic keeps
// it there), and lib/client-auth.ts sends it only to this app's own origin,
// so accepting it here does not widen who can read it.
//
// OFF SWITCH: with NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID unset there is no
// environment to check against, and every token is refused; signatures work
// as they always have.

import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { getAddress, isAddress, type Address } from "viem";

/** Scope Dynamic grants only once authentication is complete. */
export const DYNAMIC_REQUIRED_SCOPE = "user:basic";

/** Only asymmetric algorithms: a JWKS holds public keys, never shared secrets. */
const ACCEPTED_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
];

export type DynamicJwtAuth =
  | { ok: true; address: Address }
  | { ok: false; reason: string };

/** Test seam: an injected key set and environment, so tests never hit Dynamic. */
export interface DynamicJwtOptions {
  environmentId?: string;
  jwks?: JWTVerifyGetKey;
}

/** The environment's public key set. */
export function dynamicJwksUrl(environmentId: string): URL {
  return new URL(
    `https://app.dynamicauth.com/api/v0/sdk/${encodeURIComponent(environmentId)}/.well-known/jwks`,
  );
}

/** The configured Dynamic environment, or "" when sign-in is not set up. */
export function configuredDynamicEnvironmentId(): string {
  return (process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID ?? "").trim();
}

// One remote key set per environment for the life of the instance. jose caches
// the keys (ten minutes by default) and refetches on an unknown kid, rate
// limited by its cooldown so a flood of junk kids cannot hammer Dynamic.
const remoteKeySets = new Map<string, JWTVerifyGetKey>();

function remoteKeySet(environmentId: string): JWTVerifyGetKey {
  let keySet = remoteKeySets.get(environmentId);
  if (keySet === undefined) {
    keySet = createRemoteJWKSet(dynamicJwksUrl(environmentId));
    remoteKeySets.set(environmentId, keySet);
  }
  return keySet;
}

/**
 * The token from an `Authorization: Bearer <token>` header, or null when there
 * is none. The scheme is matched case-insensitively, as RFC 7235 requires.
 */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match === null ? null : match[1];
}

function hasRequiredScope(payload: JWTPayload): boolean {
  const scope = payload.scope;
  if (typeof scope !== "string") return false;
  return scope.split(/\s+/).includes(DYNAMIC_REQUIRED_SCOPE);
}

function environmentMatches(payload: JWTPayload, environmentId: string): boolean {
  const claimed = payload.environment_id;
  if (claimed !== undefined) return claimed === environmentId;
  // No environment_id claim: fall back to the issuer, which Dynamic renders
  // as "<host>/<environment id>".
  return typeof payload.iss === "string" && payload.iss.endsWith(`/${environmentId}`);
}

function listsWallet(payload: JWTPayload, address: string): boolean {
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

function describeVerifyError(err: unknown): string {
  if (err instanceof errors.JWTExpired) return "sign-in token has expired";
  if (err instanceof errors.JWTClaimValidationFailed) {
    return `sign-in token claim "${err.claim}" is invalid`;
  }
  if (err instanceof errors.JWKSNoMatchingKey) {
    return "sign-in token was not signed by this app's Dynamic environment";
  }
  if (err instanceof errors.JWSSignatureVerificationFailed) {
    return "sign-in token signature is invalid";
  }
  if (err instanceof errors.JWKSTimeout) {
    return "could not reach Dynamic to check the sign-in token";
  }
  if (err instanceof errors.JOSEError) return `sign-in token rejected (${err.code})`;
  return "sign-in token could not be verified";
}

/**
 * Verify a Dynamic session token and that it proves control of `address`.
 * Never throws; every failure is a reason the caller can log or return.
 */
export async function verifyDynamicJwt(
  params: {
    token: string;
    address: string;
    now?: number;
  } & DynamicJwtOptions,
): Promise<DynamicJwtAuth> {
  const environmentId = (
    params.environmentId ?? configuredDynamicEnvironmentId()
  ).trim();
  if (environmentId === "") {
    return {
      ok: false,
      reason: "sign-in tokens are not configured on this deployment",
    };
  }
  if (!isAddress(params.address)) {
    return { ok: false, reason: "address header is not a valid 0x address" };
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(
      params.token,
      params.jwks ?? remoteKeySet(environmentId),
      {
        algorithms: ACCEPTED_ALGORITHMS,
        requiredClaims: ["exp"],
        ...(params.now === undefined ? {} : { currentDate: new Date(params.now) }),
      },
    ));
  } catch (err) {
    return { ok: false, reason: describeVerifyError(err) };
  }

  if (!hasRequiredScope(payload)) {
    return {
      ok: false,
      reason: `sign-in token is missing the ${DYNAMIC_REQUIRED_SCOPE} scope (sign-in not complete)`,
    };
  }
  if (!environmentMatches(payload, environmentId)) {
    return {
      ok: false,
      reason: "sign-in token belongs to a different Dynamic environment",
    };
  }
  if (!listsWallet(payload, params.address)) {
    return {
      ok: false,
      reason: "sign-in token does not list this wallet",
    };
  }
  return { ok: true, address: getAddress(params.address) };
}
