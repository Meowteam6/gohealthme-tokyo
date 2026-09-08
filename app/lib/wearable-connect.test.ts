import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ClientAuth, WalletAuthRequester } from "@/lib/client-auth";
import {
  disconnectWearable,
  fetchProviderOptions,
  metricLabel,
  PhoneLinkRequiredError,
  PopupBlockedError,
  providerOptionsQueryKey,
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
        providers: [option({ observedMetrics: [] })],
        selected: "whoop",
        status: "known",
      }),
    ).toEqual([]);
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
