import { describe, it, expect, beforeEach, vi } from "vitest";
import { UnsecuredJWT } from "jose";
import { gasDripAuth, withDripLine } from "@/lib/useEnsureGas";
import { CLIENT_GAS_MIN_WEI, GAS_DRIP_STATUS_LINE, ensureGas } from "@/lib/ensure-gas";
import { clearWalletAuth } from "@/lib/client-auth";
import { GasDripRefusedError } from "@/lib/tx-errors";
import type { GaslessStatus } from "@/lib/useGasSponsorship";

const EOA: GaslessStatus = {
  paymasterConfigured: true,
  smartWalletDetected: false,
  willSponsor: false,
  reason: "plain EOA",
};

describe("withDripLine", () => {
  it("carries the drip line to the badge while a drip runs", () => {
    expect(withDripLine(EOA, GAS_DRIP_STATUS_LINE).dripLine).toBe(GAS_DRIP_STATUS_LINE);
  });

  it("hands back the same status object when idle", () => {
    expect(withDripLine(EOA, null)).toBe(EOA);
  });
});

// ------------------------------------------------ the drip's proof of wallet
//
// An email login used to sign a "prove control" message right before its first
// stake, because the drip never offered Dynamic's session token. The drip now
// rides the same credential every other private read does.

const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

function sessionToken(): string {
  return new UnsecuredJWT({
    scope: "user:basic",
    verified_credentials: [{ format: "blockchain", address: ADDRESS.toLowerCase() }],
  })
    .setExpirationTime(Math.floor(Date.now() / 1000) + 2 * 60 * 60)
    .encode();
}

/** The drip route: tops the wallet up and answers with the new balance. */
function dripRoute() {
  let balance = 0n;
  const fetchImpl = vi.fn(async () => {
    balance = CLIENT_GAS_MIN_WEI;
    return new Response(
      JSON.stringify({
        dripped: true,
        balanceWei: String(CLIENT_GAS_MIN_WEI),
        minWei: String(CLIENT_GAS_MIN_WEI),
      }),
      { status: 200 },
    );
  });
  return { fetchImpl, readBalance: async () => balance };
}

function sentHeaders(fetchImpl: ReturnType<typeof vi.fn>): Headers {
  return (fetchImpl.mock.calls[0] as unknown as [string, { headers: Headers }])[1].headers;
}

beforeEach(() => {
  clearWalletAuth();
});

describe("gasDripAuth", () => {
  it("an email login's drip sends the session token and never asks the wallet to sign", async () => {
    const token = sessionToken();
    const signMessage = vi.fn();
    const { fetchImpl, readBalance } = dripRoute();

    await ensureGas({
      address: ADDRESS,
      readBalance,
      requestAuth: gasDripAuth(ADDRESS, signMessage, {
        getSessionToken: () => token,
        proveSession: null,
      }),
      fetchImpl,
      onStatus: () => {},
      sleep: async () => {},
    });

    expect(signMessage).not.toHaveBeenCalled();
    expect(sentHeaders(fetchImpl).get("authorization")).toBe(`Bearer ${token}`);
  });

  it("a wallet login's first drip is the one session proof, not the eight-minute signature", async () => {
    let token: string | undefined;
    const proveSession = vi.fn(async () => {
      token = sessionToken();
      return "proven" as const;
    });
    const signMessage = vi.fn();
    const { fetchImpl, readBalance } = dripRoute();

    await ensureGas({
      address: ADDRESS,
      readBalance,
      requestAuth: gasDripAuth(ADDRESS, signMessage, {
        getSessionToken: () => token,
        proveSession,
      }),
      fetchImpl,
      onStatus: () => {},
      sleep: async () => {},
    });

    expect(proveSession).toHaveBeenCalledTimes(1);
    expect(signMessage).not.toHaveBeenCalled();
    expect(sentHeaders(fetchImpl).get("authorization")).toBe(`Bearer ${token}`);
  });

  it("a declined proof stops the drip with a plain reason and no second prompt", async () => {
    const signMessage = vi.fn();
    const { fetchImpl, readBalance } = dripRoute();

    await expect(
      ensureGas({
        address: ADDRESS,
        readBalance,
        requestAuth: gasDripAuth(ADDRESS, signMessage, {
          getSessionToken: () => undefined,
          proveSession: async () => "declined",
        }),
        fetchImpl,
        onStatus: () => {},
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(GasDripRefusedError);
    expect(signMessage).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("gasDripAuth never opens the wallet cold", () => {
  // Join's drip runs after a tap on Join, not on a Verify button: the wallet
  // must not open until the player has read what the signature is for.
  it("asks first, and a Not now stops the drip without opening the wallet", async () => {
    const signMessage = vi.fn();
    const confirmPrompt = vi.fn(async () => false);
    const { fetchImpl, readBalance } = dripRoute();

    await expect(
      ensureGas({
        address: ADDRESS,
        readBalance,
        requestAuth: gasDripAuth(ADDRESS, signMessage, {
          getSessionToken: () => undefined,
          proveSession: async () => "unavailable",
          confirmPrompt,
        }),
        fetchImpl,
        onStatus: () => {},
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(GasDripRefusedError);
    expect(confirmPrompt).toHaveBeenCalledWith(ADDRESS, "signature");
    expect(signMessage).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("an email login's drip is never asked about: the session token covers it", async () => {
    const token = sessionToken();
    const confirmPrompt = vi.fn(async () => true);
    const { fetchImpl, readBalance } = dripRoute();

    await ensureGas({
      address: ADDRESS,
      readBalance,
      requestAuth: gasDripAuth(ADDRESS, vi.fn(), {
        getSessionToken: () => token,
        proveSession: null,
        confirmPrompt,
      }),
      fetchImpl,
      onStatus: () => {},
      sleep: async () => {},
    });

    expect(confirmPrompt).not.toHaveBeenCalled();
    expect(sentHeaders(fetchImpl).get("authorization")).toBe(`Bearer ${token}`);
  });
});
