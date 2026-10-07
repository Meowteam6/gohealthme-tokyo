import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ClientAuth, WalletAuthRequester } from "@/lib/client-auth";
import {
  capabilityHoldOf,
  capabilityNeedsDevice,
  capabilityUnknown,
  disconnectWearable,
  fetchProviderOptions,
  parseOptions,
  metricLabel,
  PhoneLinkRequiredError,
  PopupBlockedError,
  PAIR_POLL_INTERVAL_MS,
  isIphoneUserAgent,
  pairPanelPhase,
  pairPanelPolls,
  phonePairingOf,
  providerOptionsQueryKey,
  requestPhonePairing,
  startWearableLink,
  viewerMetricsOf,
  whoopReturnMessage,
} from "@/lib/wearable-connect";

// The connect flow has three shapes now and only two were ever exercised.
// Pinned here: that a phone-only provider raises guidance rather than a
// failure, that the speculative popup is always cleaned up, that WHOOP takes
// the current tab while Junction gets its own, and that an unknown provider id
// is dropped without taking the rest of the picker down with it.

const ADDRESS = "0x1111111111111111111111111111111111111111" as `0x${string}`;

// A requester that always hands back a usable credential. Shaped as the real
// type rather than asserted at each call site, so a change to the auth
// contract shows up here instead of silently passing.
const auth: WalletAuthRequester = () =>
  Promise.resolve({
    kind: "ok",
    credential: {
      address: ADDRESS,
      timestamp: "2026-06-22T12:00:00.000Z",
      signature: "0xsig",
    },
    headers: { "x-gohealthme-address": ADDRESS },
  } as ClientAuth);

interface FakePopup {
  closed: boolean;
  opener: unknown;
  document: { title: string; body: unknown; createElement: () => unknown };
  location: { replace: (url: string) => void };
  close: () => void;
}

let popup: FakePopup | null;
let opened: string[];
let replaced: string[];
let assignedHref: string[];

function makePopup(): FakePopup {
  const p: FakePopup = {
    closed: false,
    opener: {},
    document: {
      title: "",
      body: { appendChild: () => undefined },
      createElement: () => ({ textContent: "", setAttribute: () => undefined }),
    },
    location: { replace: (url: string) => replaced.push(url) },
    close: () => {
      p.closed = true;
    },
  };
  return p;
}

beforeEach(() => {
  opened = [];
  replaced = [];
  assignedHref = [];
  popup = makePopup();
  vi.stubGlobal("window", {
    open: (url: string) => {
      opened.push(url);
      return popup;
    },
    get location() {
      return {
        get href() {
          return "https://app.test/dashboard";
        },
        set href(value: string) {
          assignedHref.push(value);
        },
      };
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function respond(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("startWearableLink", () => {
  it("gives Junction its own tab and navigates the popup", async () => {
    respond({ provider: "junction", kind: "oauth", linkUrl: "https://link.test/x" });

    await startWearableLink(ADDRESS, auth);

    // Opened synchronously inside the gesture tick, then navigated.
    expect(opened).toEqual(["about:blank"]);
    expect(replaced).toEqual(["https://link.test/x"]);
    // Reverse-tabnabbing reference severed before the cross-origin nav.
    expect(popup?.opener).toBeNull();
  });

  it("takes the CURRENT tab for WHOOP and closes the speculative popup", async () => {
    respond({
      provider: "whoop",
      kind: "oauth",
      linkUrl: "/api/whoop/login?ticket=abc",
    });

    await startWearableLink(ADDRESS, auth);

    // WHOOP's OAuth ends on our own dashboard, so a popup would strand the
    // user in a window they have to close while the real tab goes stale.
    expect(assignedHref).toEqual(["/api/whoop/login?ticket=abc"]);
    expect(popup?.closed).toBe(true);
    expect(replaced).toEqual([]);
  });

  it("sends the page's return path to the link route", async () => {
    respond({
      provider: "whoop",
      kind: "oauth",
      linkUrl: "/api/whoop/login?ticket=abc&next=%2Fcharacter",
    });

    await startWearableLink(ADDRESS, auth, "whoop", "/character?step=sensor");

    const fetchMock = globalThis.fetch as unknown as {
      mock: { calls: Array<[string, RequestInit | undefined]> };
    };
    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      address: ADDRESS,
      provider: "whoop",
      next: "/character?step=sensor",
    });
  });

  // Inside the iPhone app (lib/shell.ts) window.open returns null, so the
  // popup dance would end in PopupBlockedError and a second tap. The connect
  // page goes to the shell's Safari sheet instead, in one message.
  describe("inside the iPhone app", () => {
    let postMessage: ReturnType<typeof vi.fn<(message: string) => void>>;

    beforeEach(() => {
      postMessage = vi.fn<(message: string) => void>();
      vi.stubGlobal("navigator", {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GoHealthMeShell/1.0.0",
      });
      vi.stubGlobal("window", {
        ReactNativeWebView: { postMessage },
        open: (url: string) => {
          opened.push(url);
          return null;
        },
        get location() {
          return {
            get href() {
              return "https://app.test/dashboard";
            },
            set href(value: string) {
              assignedHref.push(value);
            },
          };
        },
      });
    });

    it("hands Junction's page to the shell once, opens no window and throws nothing", async () => {
      respond({ provider: "junction", kind: "oauth", linkUrl: "https://link.tryvital.io/x" });

      await startWearableLink(ADDRESS, auth);

      expect(opened).toEqual([]);
      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(JSON.parse(postMessage.mock.calls[0]?.[0] ?? "")).toEqual({
        v: 1,
        type: "open-browser",
        url: "https://link.tryvital.io/x",
      });
      expect(assignedHref).toEqual([]);
    });

    it("still takes the current page for WHOOP", async () => {
      respond({ provider: "whoop", kind: "oauth", linkUrl: "/api/whoop/login?ticket=abc" });

      await startWearableLink(ADDRESS, auth);

      expect(assignedHref).toEqual(["/api/whoop/login?ticket=abc"]);
      expect(postMessage).not.toHaveBeenCalled();
      expect(opened).toEqual([]);
    });

    it("raises the phone-link guidance for Apple there too, with nothing posted", async () => {
      respond({ provider: "apple", kind: "app", linkUrl: null, instructions: "Open the app." });
      await expect(startWearableLink(ADDRESS, auth, "apple")).rejects.toBeInstanceOf(
        PhoneLinkRequiredError,
      );
      expect(postMessage).not.toHaveBeenCalled();
    });
  });

  it("raises phone-link guidance, not an error, for a phone-only provider", async () => {
    const instructions = "Open the GoHealthMe app on your iPhone.";
    respond({ provider: "apple", kind: "app", linkUrl: null, instructions });

    await expect(startWearableLink(ADDRESS, auth)).rejects.toBeInstanceOf(
      PhoneLinkRequiredError,
    );
    // The speculative popup must not be left open on a page that can never
    // load: there is nothing for this browser to show.
    expect(popup?.closed).toBe(true);
  });

  it("carries the instructions through verbatim for the caller to render", async () => {
    const instructions = "Allow Apple Health when the app asks.";
    respond({ provider: "apple", kind: "app", linkUrl: null, instructions });

    await startWearableLink(ADDRESS, auth).catch((err: unknown) => {
      expect(err).toBeInstanceOf(PhoneLinkRequiredError);
      expect((err as PhoneLinkRequiredError).instructions).toBe(instructions);
    });
    expect.assertions(2);
  });

  it("follows a deep link when a phone provider supplies one", async () => {
    respond({
      provider: "apple",
      kind: "app",
      linkUrl: "gohealthme://link",
      instructions: "unused",
    });

    await startWearableLink(ADDRESS, auth);

    expect(assignedHref).toEqual(["gohealthme://link"]);
    expect(popup?.closed).toBe(true);
  });

  it("reports a blocked popup with the real URL so a tap can finish it", async () => {
    popup = null;
    respond({ provider: "junction", kind: "oauth", linkUrl: "https://link.test/y" });

    await startWearableLink(ADDRESS, auth).catch((err: unknown) => {
      expect(err).toBeInstanceOf(PopupBlockedError);
      expect((err as PopupBlockedError).linkUrl).toBe("https://link.test/y");
    });
    expect.assertions(2);
  });

  it("closes the popup when the request itself fails", async () => {
    respond({ error: "The whoop connection is not available." }, 503);

    await expect(startWearableLink(ADDRESS, auth)).rejects.toThrow(
      /not available/,
    );
    // Relays the route's honest reason rather than "try again", which is
    // advice that cannot work against a missing server credential.
    expect(popup?.closed).toBe(true);
  });
});

describe("fetchProviderOptions", () => {
  it("drops an unknown provider id without losing the rest of the picker", async () => {
    respond({
      providers: [
        {
          id: "whoop",
          label: "WHOOP",
          configured: true,
          connected: true,
          metrics: ["sleep_score"],
          observedMetrics: null,
          capability: "declared",
        },
        { id: "garmin", label: "Garmin", configured: true, connected: true, metrics: [] },
      ],
      selected: "whoop",
    });

    const options = await fetchProviderOptions(ADDRESS, auth);

    expect(options.providers.map((p) => p.id)).toEqual(["whoop"]);
    expect(options.selected).toBe("whoop");
  });

  it("degrades to no choice offered rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    // A picker that cannot load must not take the connect button off screen.
    await expect(fetchProviderOptions(ADDRESS, auth)).resolves.toEqual({
      providers: [],
      selected: null,
      status: "unavailable",
    });
  });
});

describe("viewerMetricsOf", () => {
  const option = (over: Record<string, unknown> = {}) => ({
    id: "whoop" as const,
    label: "WHOOP",
    configured: true,
    connected: true,
    metrics: ["sleep_score" as const],
    observedMetrics: null,
    capability: "declared" as const,
    ...over,
  });

  it("returns the active provider's declared metrics when nothing narrows them", () => {
    expect(
      viewerMetricsOf({ providers: [option()], selected: "whoop" , status: "known" }),
    ).toEqual(["sleep_score"]);
  });

  it("prefers what the wallet's own device actually produced", () => {
    // The case this exists for: the integration declares sleep_score, and this
    // person's tracker has never produced one. Trusting the declared list
    // would invite them to stake on a pool they can never satisfy.
    expect(
      viewerMetricsOf({
        providers: [
          option({
            metrics: ["sleep_score", "steps"],
            observedMetrics: ["steps"],
            capability: "observed" as const,
          }),
        ],
        selected: "whoop",
        status: "known",
      }),
    ).toEqual(["steps"]);
  });

  it("treats an observed empty list as narrowing to nothing, not as unknown", () => {
    // A provider that returns [] is saying "this device produced none of
    // these". Null is how it says "I cannot narrow"; the two differ.
    expect(
      viewerMetricsOf({
        providers: [option({ observedMetrics: [], capability: "observed" as const })],
        selected: "whoop",
        status: "known",
      }),
    ).toEqual([]);
  });

  it("withholds everything when the server could not establish anything", () => {
    // The Junction-outage case. Falling back to the declared union here is
    // what handed a wallet all seven metrics on no evidence, cached for half
    // an hour, and the probe written to prevent learn-after-the-stake was the
    // thing producing it.
    expect(
      viewerMetricsOf({
        providers: [option({ capability: "unknown" as const })],
        selected: "whoop",
        status: "known",
      }),
    ).toBeNull();
  });

  it("is null - not empty - whenever the device is not actually known", () => {
    // Null and [] must stay distinguishable: [] would gate every wearable pool
    // off the board, null holds nothing back.
    expect(viewerMetricsOf(undefined)).toBeNull();
    expect(
      viewerMetricsOf({ providers: [option()], selected: null , status: "known" }),
    ).toBeNull();
    expect(
      viewerMetricsOf({
        providers: [option({ connected: false })],
        selected: "whoop",
        status: "known",
      }),
    ).toBeNull();
    expect(
      viewerMetricsOf({
        providers: [option({ configured: false })],
        selected: "whoop",
        status: "known",
      }),
    ).toBeNull();
  });
});

describe("disconnectWearable", () => {
  it("resolves to null when the device was unlinked", async () => {
    respond({ disconnected: true, provider: "whoop" });
    await expect(disconnectWearable(ADDRESS, auth)).resolves.toBeNull();
  });

  it("returns a 409 as guidance, not as a thrown failure", async () => {
    // Junction owns its own link, so the honest answer names its connection
    // page. That is a real next step and must not render as an error.
    respond(
      { error: "Disconnecting is handled by Junction's own connection page." },
      409,
    );

    await expect(disconnectWearable(ADDRESS, auth)).resolves.toMatch(
      /Junction's own connection page/,
    );
  });

  it("throws on a real failure so the caller can surface it", async () => {
    respond({ error: "Could not disconnect the device right now" }, 502);
    await expect(disconnectWearable(ADDRESS, auth)).rejects.toThrow(
      /Could not disconnect/,
    );
  });
});

describe("whoopReturnMessage", () => {
  it("words a declined consent as a choice, not a failure", () => {
    expect(whoopReturnMessage("declined")?.tone).toBe("info");
    expect(whoopReturnMessage("connected")?.tone).toBe("ok");
    expect(whoopReturnMessage("failed")?.tone).toBe("error");
    expect(whoopReturnMessage("unavailable")?.tone).toBe("error");
    expect(whoopReturnMessage("expired")?.tone).toBe("error");
  });

  it("says nothing when there is nothing to report", () => {
    expect(whoopReturnMessage(null)).toBeNull();
    expect(whoopReturnMessage("something-else")).toBeNull();
  });
});

describe("metricLabel", () => {
  it("names every metric in plain language", () => {
    expect(metricLabel("steps")).toBe("step count");
    expect(metricLabel("sleep_score")).toBe("sleep score");
    expect(metricLabel("sleep_efficiency")).toBe("sleep efficiency");
  });
});

describe("providerOptionsQueryKey", () => {
  it("is per address so two wallets never share a picker", () => {
    expect(providerOptionsQueryKey(ADDRESS)).not.toEqual(
      providerOptionsQueryKey(null),
    );
  });

});

describe("linked-but-held capability", () => {
  const junction = (over: Record<string, unknown> = {}) => ({
    id: "junction" as const,
    label: "Junction",
    configured: true,
    connected: true,
    metrics: ["sleep_score" as const, "steps" as const, "workouts" as const],
    observedMetrics: null,
    capability: "awaiting-sync" as const,
    ...over,
  });
  const known = (over: Record<string, unknown> = {}) => ({
    providers: [junction(over)],
    selected: "junction" as const,
    status: "known" as const,
  });

  it("does not hand an unsynced Junction wallet the declared union", () => {
    // The WHOOP-via-Junction trap: the union includes steps, and a WHOOP
    // strap has no pedometer. No answer until the first sync.
    expect(viewerMetricsOf(known())).toBeNull();
    expect(capabilityHoldOf(known())).toBe("awaiting-sync");
    // A linked device is never "pair a sensor".
    expect(capabilityNeedsDevice(known())).toBe(false);
    expect(capabilityUnknown(known())).toBe(true);
  });

  it("reports a linked device the provider will not describe as unreadable", () => {
    const options = known({ capability: "unknown" });
    expect(viewerMetricsOf(options)).toBeNull();
    expect(capabilityHoldOf(options)).toBe("unreadable");
    expect(capabilityNeedsDevice(options)).toBe(false);
  });

  it("still says 'needs a device' when nothing is linked", () => {
    const options = known({ connected: false, capability: "declared" });
    expect(capabilityHoldOf(options)).toBeNull();
    expect(capabilityNeedsDevice(options)).toBe(true);
  });

  it("has no hold once the device has synced", () => {
    const options = known({
      capability: "observed",
      observedMetrics: ["sleep_score", "workouts"],
    });
    expect(capabilityHoldOf(options)).toBeNull();
    expect(viewerMetricsOf(options)).toEqual(["sleep_score", "workouts"]);
  });

  it("has no hold before a signature, because that is a different question", () => {
    expect(
      capabilityHoldOf({ providers: [], selected: null, status: "unauthenticated" }),
    ).toBeNull();
  });

  it("parses awaiting-sync off the wire instead of widening it to declared", async () => {
    respond({ providers: [junction()], selected: "junction" });

    const options = await fetchProviderOptions(ADDRESS, auth);

    expect(options.providers[0]?.capability).toBe("awaiting-sync");
    expect(viewerMetricsOf(options)).toBeNull();
  });
});

describe("provider note", () => {
  it("carries the server's note so the pairing card can say why a provider is off", () => {
    const options = parseOptions({
      providers: [
        { id: "whoop", label: "WHOOP", configured: false, connected: false, metrics: [], note: "WHOOP's direct seats are full." },
        { id: "junction", label: "Junction", configured: true, connected: false, metrics: [] },
      ],
      selected: null,
    });
    expect(options.providers.find((p) => p.id === "whoop")?.note).toBe("WHOOP's direct seats are full.");
    expect(options.providers.find((p) => p.id === "junction")?.note).toBeNull();
  });
});

// The Apple Watch pairing panel's pure pieces (components/PhonePairPanel.tsx
// renders them): which device the page is on, whether a code is still live,
// and what the provider list says about the phone. Pinned here so the panel
// can flip to paired on its own, off the same read the join gate uses, and
// never off a button the player presses.
describe("phone pairing", () => {
  const PAIRING = {
    code: "7KQ4MN9P",
    deepLink: "gohealthme://pair?code=7KQ4MN9P",
    expiresAt: 1_800_000_000_000,
  };
  const APP_LINK = {
    provider: "apple",
    kind: "app",
    linkUrl: null,
    instructions: "Open the app.",
    pairing: PAIRING,
    installUrl: "https://testflight.apple.com/join/abc",
  };

  it("knows an iPhone from its user agent and nothing else", () => {
    expect(
      isIphoneUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(true);
    expect(
      isIphoneUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      ),
    ).toBe(false);
    expect(
      isIphoneUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36",
      ),
    ).toBe(false);
    expect(isIphoneUserAgent("")).toBe(false);
  });

  it("opens no popup when the phone provider is asked for by id", async () => {
    respond(APP_LINK);
    await expect(startWearableLink(ADDRESS, auth, "apple")).rejects.toBeInstanceOf(
      PhoneLinkRequiredError,
    );
    // A blank tab that opens and closes again is a flash on the phone the
    // player is about to pair, and nothing was ever going to load in it.
    expect(opened).toEqual([]);
  });

  it("mints a fresh code without a popup, for the one-tap new code", async () => {
    respond(APP_LINK);
    const steps = await requestPhonePairing(ADDRESS, auth);
    expect(steps.pairing).toEqual(PAIRING);
    expect(steps.installUrl).toBe("https://testflight.apple.com/join/abc");
    expect(opened).toEqual([]);
  });

  it("refuses a web link where a phone pairing was expected", async () => {
    respond({ provider: "whoop", kind: "oauth", linkUrl: "/api/whoop/login" });
    await expect(requestPhonePairing(ADDRESS, auth)).rejects.toThrow(/iPhone app/);
  });

  function apple(over: Record<string, unknown>) {
    return parseOptions({
      selected: "apple",
      providers: [
        {
          id: "apple",
          label: "Apple Health",
          configured: true,
          connected: false,
          metrics: ["sleep_efficiency", "sleep_hours", "steps", "workouts"],
          observedMetrics: null,
          capability: "declared",
          ...over,
        },
      ],
    });
  }

  it("reads paired off the provider list once the phone has stored a sync", () => {
    expect(
      phonePairingOf(
        apple({ connected: true, capability: "observed", observedMetrics: ["sleep_hours", "workouts"] }),
      ),
    ).toEqual({ kind: "paired", label: "Apple Health", metrics: ["sleep_hours", "workouts"] });
  });

  it("is awaiting-sync while the phone is linked and nothing has arrived", () => {
    expect(phonePairingOf(apple({ connected: true, capability: "awaiting-sync" }))).toEqual({
      kind: "awaiting-sync",
      label: "Apple Health",
    });
  });

  it("is unreadable when the phone is linked and the server could not say what it counts", () => {
    expect(phonePairingOf(apple({ connected: true, capability: "unknown" }))).toEqual({
      kind: "unreadable",
      label: "Apple Health",
    });
  });

  it("is unpaired until Apple itself is connected, whatever else the wallet linked", () => {
    expect(phonePairingOf(apple({}))).toEqual({ kind: "unpaired" });
    expect(phonePairingOf(undefined)).toEqual({ kind: "unpaired" });
    expect(
      phonePairingOf(
        parseOptions({
          selected: "whoop",
          providers: [
            { id: "whoop", label: "WHOOP", configured: true, connected: true, capability: "declared", metrics: ["sleep_hours"] },
          ],
        }),
      ),
    ).toEqual({ kind: "unpaired" });
  });

  it("phases the panel: live while the code is fresh, expired after, paired over both", () => {
    const unpaired = { kind: "unpaired" } as const;
    expect(pairPanelPhase(PAIRING, unpaired, PAIRING.expiresAt - 1)).toBe("live");
    expect(pairPanelPhase(PAIRING, unpaired, PAIRING.expiresAt)).toBe("expired");
    expect(pairPanelPhase(null, unpaired, 0)).toBe("no-code");
    expect(
      pairPanelPhase(PAIRING, { kind: "paired", label: "Apple Health", metrics: [] }, PAIRING.expiresAt + 1),
    ).toBe("paired");
    expect(pairPanelPhase(PAIRING, { kind: "awaiting-sync", label: "Apple Health" }, 0)).toBe(
      "awaiting-sync",
    );
    expect(pairPanelPhase(PAIRING, { kind: "unreadable", label: "Apple Health" }, 0)).toBe(
      "unreadable",
    );
  });

  it("polls only while a pairing can still land, and never past the code's ten minutes", () => {
    const fresh = PAIRING.expiresAt - 1;
    expect(pairPanelPolls("live", PAIRING, fresh)).toBe(true);
    expect(pairPanelPolls("awaiting-sync", PAIRING, fresh)).toBe(true);
    // The phone redeemed the code and nothing arrived inside its window: the
    // next focus of the tab re-reads anyway, so the timer stops here.
    expect(pairPanelPolls("awaiting-sync", PAIRING, PAIRING.expiresAt)).toBe(false);
    expect(pairPanelPolls("awaiting-sync", null, fresh)).toBe(false);
    for (const phase of ["paired", "unreadable", "expired", "no-code"] as const) {
      expect(pairPanelPolls(phase, PAIRING, fresh)).toBe(false);
    }
    // A re-pair reads paired before and after the new phone redeems the code,
    // so there is nothing a poll could notice; the timer never starts.
    expect(pairPanelPolls("live", PAIRING, fresh, true)).toBe(false);
    // Inside the iPhone app the shell says when the phone synced and the
    // card re-reads on that word, so the timer never starts there either.
    expect(pairPanelPolls("live", PAIRING, fresh, false, true)).toBe(false);
    expect(pairPanelPolls("awaiting-sync", PAIRING, fresh, false, true)).toBe(false);
    expect(PAIR_POLL_INTERVAL_MS).toBe(3_000);
  });
});
