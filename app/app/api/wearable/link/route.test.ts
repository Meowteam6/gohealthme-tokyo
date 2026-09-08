import { PROVIDER_IDS } from "@/lib/wearable-providers";
// POST /api/wearable/link starts a device connection for a wallet. Pinned here:
//
//   - THE SIGNATURE GATE, WHICH IS NEW. The Junction-only predecessor was
//     unauthenticated, and that was survivable there: creating a Junction user
//     for somebody else's address only ever made an empty record. A WHOOP grant
//     is a live credential, so an unauthenticated start would let anyone attach
//     their own WHOOP account to a stranger's wallet - overwriting that
//     person's real connection and pointing someone else's sleep data at a
//     wallet that gets paid. Unsigned starts are 401, and nothing is chosen,
//     recorded or minted on the way out.
//   - a bad or missing address is a 400 BEFORE the signature check, and an
//     unknown provider name is a 400 before anything is recorded.
//   - a provider this deployment cannot serve is a 503, not a retry-forever
//     500 and not a fake link URL.
//   - THE CHOICE IS RECORDED BEFORE THE REDIRECT. setProviderId runs before the
//     WHOOP ticket is minted and before Junction's hosted page is requested, so
//     the callback and every later background verification read the same
//     provider the user is about to link. A choice written only on success
//     would leave a user who abandons the consent screen pointed at the other
//     provider.
//   - both link shapes: WHOOP goes through this app's own /api/whoop/login
//     carrying a wallet-bound ticket (a top-level navigation cannot send auth
//     headers), Junction returns the provider's own hosted linkUrl.
//   - an upstream failure is a generic 502 with the real cause logged. This is
//     the credential gate: with no key every provider call throws, so the route
//     reports the failure rather than pretending a device could be linked.

import { describe, it, expect, vi, beforeEach } from "vitest";

const providerById = vi.fn();
const providerConfigured = vi.fn();
const providerIdFor = vi.fn();
const setProviderId = vi.fn();
const startLink = vi.fn();
const mintLinkTicket = vi.fn();
const requireAddressSignature = vi.fn();

vi.mock("@/lib/server/wearable", () => {
  // isProviderId/PROVIDER_IDS keep their real behaviour: the route's 400 for
  // an unknown provider name IS this predicate, so stubbing it would test
  // nothing. They are pure functions over a two-element union.
  const PROVIDER_IDS = ["junction", "whoop"] as const;
  return {
    PROVIDER_IDS,
    isProviderId: (value: unknown) =>
      typeof value === "string" &&
      (PROVIDER_IDS as readonly string[]).includes(value),
    providerById: (...args: unknown[]) => providerById(...args),
    providerConfigured: (...args: unknown[]) => providerConfigured(...args),
    providerIdFor: (...args: unknown[]) => providerIdFor(...args),
    setProviderId: (...args: unknown[]) => setProviderId(...args),
    providerFor: vi.fn(),
  };
});
vi.mock("@/lib/server/wearable/link-ticket", () => ({
  mintLinkTicket: (...args: unknown[]) => mintLinkTicket(...args),
}));
vi.mock("@/lib/server/wallet-auth", () => ({
  requireAddressSignature: (...args: unknown[]) =>
    requireAddressSignature(...args),
}));

const { POST } = await import("@/app/api/wearable/link/route");

const USER = "0x1111111111111111111111111111111111111111";
const JUNCTION_LINK_URL =
  "https://link.tryvital.io/?token=abc&env=sandbox&region=us";

function post(body: unknown, raw = false) {
  return POST(
    new Request("http://localhost/api/wearable/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAddressSignature.mockResolvedValue({ ok: true, address: USER });
  providerIdFor.mockResolvedValue("junction");
  providerConfigured.mockReturnValue(true);
  providerById.mockImplementation((id: string) => ({
    id,
    startLink: (...args: unknown[]) => startLink(...args),
  }));
  startLink.mockResolvedValue({ linkUrl: JUNCTION_LINK_URL });
  setProviderId.mockResolvedValue(undefined);
  mintLinkTicket.mockReturnValue("cGF5bG9hZA.c2ln");
});

describe("POST /api/wearable/link", () => {
  it("rejects a non-string address before auth or any provider work", async () => {
    const res = await post({ address: 42 });
    expect(res.status).toBe(400);
    expect(requireAddressSignature).not.toHaveBeenCalled();
    expect(setProviderId).not.toHaveBeenCalled();
    expect(startLink).not.toHaveBeenCalled();
  });

  it("rejects a malformed 0x address before auth or any provider work", async () => {
    const res = await post({ address: "0xnope" });
    expect(res.status).toBe(400);
    expect(requireAddressSignature).not.toHaveBeenCalled();
    expect(setProviderId).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON", async () => {
    const res = await post("{not json", true);
    expect(res.status).toBe(400);
    expect(requireAddressSignature).not.toHaveBeenCalled();
    expect(setProviderId).not.toHaveBeenCalled();
  });

  it("refuses an unsigned start: 401, and no provider is chosen or recorded", async () => {
    requireAddressSignature.mockResolvedValue({
      ok: false,
      reason: "missing wallet signature headers",
    });
    const res = await post({ address: USER, provider: "whoop" });
    expect(res.status).toBe(401);
    // The boundary: nobody attaches a live WHOOP grant to a wallet they do not
    // control, and the wallet's stored provider is left exactly as it was.
    expect(providerIdFor).not.toHaveBeenCalled();
    expect(setProviderId).not.toHaveBeenCalled();
    expect(mintLinkTicket).not.toHaveBeenCalled();
    expect(startLink).not.toHaveBeenCalled();
  });

  it("rejects a provider name that is neither junction nor whoop", async () => {
    const res = await post({ address: USER, provider: "oura" });
    expect(res.status).toBe(400);
    // Derived from the registry, not spelled out: the message must name every
    // provider a deployment actually offers, including ones added later.
    expect((await res.json()).error).toBe(
      `provider must be one of: ${PROVIDER_IDS.join(", ")}`,
    );
    expect(setProviderId).not.toHaveBeenCalled();
    expect(startLink).not.toHaveBeenCalled();
  });

  it("rejects a non-string provider", async () => {
    const res = await post({ address: USER, provider: 7 });
    expect(res.status).toBe(400);
    expect(setProviderId).not.toHaveBeenCalled();
    expect(startLink).not.toHaveBeenCalled();
  });

  it("reports an unconfigured provider as a 503, not a retry and not a fake link", async () => {
    providerConfigured.mockReturnValue(false);
    const res = await post({ address: USER, provider: "whoop" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("whoop");
    // A configuration gap must not be recorded as the wallet's choice, and no
    // link may be handed out for a path that cannot complete.
    expect(setProviderId).not.toHaveBeenCalled();
    expect(mintLinkTicket).not.toHaveBeenCalled();
    expect(startLink).not.toHaveBeenCalled();
  });

  it("returns Junction's own hosted linkUrl for the junction path", async () => {
    const res = await post({ address: USER });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      provider: "junction",
      linkUrl: JUNCTION_LINK_URL,
    });
    // No explicit provider in the body means the wallet's resolved provider.
    expect(providerIdFor).toHaveBeenCalledWith(USER);
    expect(providerById).toHaveBeenCalledWith("junction");
    expect(startLink).toHaveBeenCalledWith(USER);
    expect(mintLinkTicket).not.toHaveBeenCalled();
  });

  it("records the choice BEFORE asking Junction for a link", async () => {
    await post({ address: USER });
    expect(setProviderId).toHaveBeenCalledWith(USER, "junction");
    expect(setProviderId.mock.invocationCallOrder[0]).toBeLessThan(
      startLink.mock.invocationCallOrder[0],
    );
  });

  it("sends the WHOOP path through this app's own login with a wallet-bound ticket", async () => {
    const res = await post({ address: USER, provider: "whoop" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: string; linkUrl: string };
    expect(body.provider).toBe("whoop");
    expect(body.linkUrl.startsWith("/api/whoop/login?ticket=")).toBe(true);
    expect(body.linkUrl).toBe("/api/whoop/login?ticket=cGF5bG9hZA.c2ln");
    // The ticket names the address that was just proven, not one from the body
    // of some later request.
    expect(mintLinkTicket).toHaveBeenCalledWith(USER);
    // An explicit provider wins over the stored one, and Junction is untouched.
    expect(providerIdFor).not.toHaveBeenCalled();
    expect(startLink).not.toHaveBeenCalled();
  });

  it("records the choice BEFORE minting the WHOOP redirect ticket", async () => {
    await post({ address: USER, provider: "whoop" });
    expect(setProviderId).toHaveBeenCalledWith(USER, "whoop");
    expect(setProviderId.mock.invocationCallOrder[0]).toBeLessThan(
      mintLinkTicket.mock.invocationCallOrder[0],
    );
  });

  it("follows the wallet's stored provider when the body names none", async () => {
    providerIdFor.mockResolvedValue("whoop");
    const res = await post({ address: USER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { provider: string; linkUrl: string };
    expect(body.provider).toBe("whoop");
    expect(body.linkUrl.startsWith("/api/whoop/login?ticket=")).toBe(true);
    expect(setProviderId).toHaveBeenCalledWith(USER, "whoop");
  });

  it("maps an upstream failure to a generic 502 and logs the real cause", async () => {
    // With no provider credential the client throws before the first fetch; an
    // invalid key throws on the 401. Either way the route must answer, not 500.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    startLink.mockRejectedValue(
      new Error("Junction /v2/link/token returned 401: invalid api key"),
    );
    const res = await post({ address: USER });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    // Generic on the wire: no upstream path, no key state, no provider message.
    expect(body.error).toBe("Could not start the device connection right now");
    expect(body.error).not.toContain("401");
    expect(body.error).not.toContain("api key");
    // Loud where it matters.
    expect(consoleError).toHaveBeenCalledOnce();
    expect(String(consoleError.mock.calls[0])).toContain("401");
    consoleError.mockRestore();
  });
});
