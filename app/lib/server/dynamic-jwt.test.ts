// Tokens here are signed with key pairs generated in the test, and verified
// against a local JWKS built from the public half. That is the same shape as
// production (Dynamic signs, we check against Dynamic's JWKS), minus the
// network: the JWKS is injected, so nothing here reaches app.dynamicauth.com.
import { beforeAll, describe, expect, it } from "vitest";
import {
  SignJWT,
  UnsecuredJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DYNAMIC_REQUIRED_SCOPE,
  dynamicJwksUrl,
  readBearerToken,
  verifyDynamicJwt,
} from "@/lib/server/dynamic-jwt";

const ENV_ID = "0f2d7c1e-5a4b-4c3d-9e8f-123456789abc";
const OTHER_ENV_ID = "99999999-8888-7777-6666-555555555555";
const KID = "dynamic-test-key";

const OWNER = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
).address;
const STRANGER = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
).address;

const NOW = Date.parse("2026-09-27T00:00:00.000Z");
const NOW_S = Math.floor(NOW / 1000);

let dynamicKey: CryptoKey;
let forgerKey: CryptoKey;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const dynamic = await generateKeyPair("RS256", { extractable: true });
  const forger = await generateKeyPair("RS256", { extractable: true });
  dynamicKey = dynamic.privateKey;
  forgerKey = forger.privateKey;
  const publicJwk = await exportJWK(dynamic.publicKey);
  jwks = createLocalJWKSet({
    keys: [{ ...publicJwk, kid: KID, alg: "RS256", use: "sig" }],
  });
});

function claims(overrides: JWTPayload = {}): JWTPayload {
  return {
    environment_id: ENV_ID,
    iss: `app.dynamicauth.com/${ENV_ID}`,
    sub: "user-1",
    scope: DYNAMIC_REQUIRED_SCOPE,
    verified_credentials: [
      { format: "email", email: "player@example.com", id: "vc-email" },
      {
        format: "blockchain",
        address: OWNER.toLowerCase(),
        chain: "eip155",
        id: "vc-wallet",
        wallet_provider: "embeddedWallet",
      },
    ],
    ...overrides,
  };
}

async function token(
  overrides: JWTPayload = {},
  options: { key?: CryptoKey; exp?: number | null } = {},
): Promise<string> {
  const builder = new SignJWT(claims(overrides))
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt(NOW_S - 60);
  if (options.exp !== null) builder.setExpirationTime(options.exp ?? NOW_S + 3600);
  return builder.sign(options.key ?? dynamicKey);
}

function verify(tokenValue: string, address: string = OWNER) {
  return verifyDynamicJwt({
    token: tokenValue,
    address,
    now: NOW,
    environmentId: ENV_ID,
    jwks,
  });
}

describe("dynamicJwksUrl", () => {
  it("points at the environment's own key set", () => {
    expect(dynamicJwksUrl(ENV_ID).href).toBe(
      `https://app.dynamicauth.com/api/v0/sdk/${ENV_ID}/.well-known/jwks`,
    );
  });
});

describe("readBearerToken", () => {
  const withAuth = (value: string) =>
    new Request("https://x/api/t", { headers: { authorization: value } });

  it("reads the token after the Bearer scheme", () => {
    expect(readBearerToken(withAuth("Bearer abc.def.ghi"))).toBe("abc.def.ghi");
  });

  it("accepts the scheme in any case", () => {
    expect(readBearerToken(withAuth("bearer abc.def.ghi"))).toBe("abc.def.ghi");
  });

  it("returns null with no Authorization header", () => {
    expect(readBearerToken(new Request("https://x/api/t"))).toBeNull();
  });

  it("returns null for another scheme or an empty token", () => {
    expect(readBearerToken(withAuth("Basic dXNlcjpwYXNz"))).toBeNull();
    expect(readBearerToken(withAuth("Bearer "))).toBeNull();
  });
});

describe("verifyDynamicJwt", () => {
  it("accepts a valid token that lists the claimed wallet", async () => {
    expect(await verify(await token())).toEqual({
      ok: true,
      address: getAddress(OWNER),
    });
  });

  it("matches the wallet case-insensitively and returns it checksummed", async () => {
    const result = await verify(await token(), OWNER.toLowerCase());
    expect(result).toEqual({ ok: true, address: getAddress(OWNER) });
  });

  it("accepts user:basic among other scopes", async () => {
    const result = await verify(
      await token({ scope: `something:else ${DYNAMIC_REQUIRED_SCOPE}` }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a forged token signed by a different key", async () => {
    const result = await verify(await token({}, { key: forgerKey }));
    expect(result.ok).toBe(false);
  });

  it("rejects an unsigned (alg none) token", async () => {
    const unsigned = new UnsecuredJWT(claims())
      .setIssuedAt(NOW_S - 60)
      .setExpirationTime(NOW_S + 3600)
      .encode();
    expect((await verify(unsigned)).ok).toBe(false);
  });

  it("rejects an expired token", async () => {
    const result = await verify(await token({}, { exp: NOW_S - 1 }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/expired/);
  });

  it("rejects a token with no expiry", async () => {
    expect((await verify(await token({}, { exp: null }))).ok).toBe(false);
  });

  it("rejects a token without the user:basic scope (auth incomplete, e.g. MFA pending)", async () => {
    const result = await verify(await token({ scope: "requiresAdditionalAuth" }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/user:basic/);
  });

  it("rejects a token with no scope claim at all", async () => {
    expect((await verify(await token({ scope: undefined }))).ok).toBe(false);
  });

  it("does not accept a scope that merely contains user:basic as a substring", async () => {
    expect((await verify(await token({ scope: "user:basics" }))).ok).toBe(false);
  });

  it("rejects a token from another Dynamic environment", async () => {
    const result = await verify(
      await token({
        environment_id: OTHER_ENV_ID,
        iss: `app.dynamicauth.com/${OTHER_ENV_ID}`,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/environment/);
  });

  it("falls back to the issuer when environment_id is absent", async () => {
    expect(
      (await verify(await token({ environment_id: undefined }))).ok,
    ).toBe(true);
    expect(
      (
        await verify(
          await token({
            environment_id: undefined,
            iss: `app.dynamicauth.com/${OTHER_ENV_ID}`,
          }),
        )
      ).ok,
    ).toBe(false);
  });

  it("rejects a token that names neither environment_id nor a matching issuer", async () => {
    const result = await verify(
      await token({ environment_id: undefined, iss: undefined }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a wallet the token does not list", async () => {
    const result = await verify(await token(), STRANGER);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/does not list/);
  });

  it("only counts blockchain credentials as wallet proof", async () => {
    const result = await verify(
      await token({
        verified_credentials: [{ format: "email", address: OWNER, id: "x" }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a token whose verified_credentials is missing or malformed", async () => {
    expect(
      (await verify(await token({ verified_credentials: undefined }))).ok,
    ).toBe(false);
    expect(
      (await verify(await token({ verified_credentials: "0xabc" }))).ok,
    ).toBe(false);
  });

  it("rejects a malformed claimed address", async () => {
    const result = await verify(await token(), "0xnope");
    expect(result).toEqual({
      ok: false,
      reason: "address header is not a valid 0x address",
    });
  });

  it("is off when no Dynamic environment is configured", async () => {
    const result = await verifyDynamicJwt({
      token: await token(),
      address: OWNER,
      now: NOW,
      environmentId: "",
      jwks,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/not configured/);
  });

  it("rejects garbage without throwing", async () => {
    expect((await verify("not-a-jwt")).ok).toBe(false);
  });
});
