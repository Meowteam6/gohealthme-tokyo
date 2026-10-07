import { beforeEach, describe, expect, it, vi } from "vitest";

// The pairing pipeline the shell and the standalone screen share: redeem the
// website's code, keep the token, ask for Apple Health once, listen for
// background delivery, read the first month. Every step reports to the page
// as a pair-status event, and every failure names a reason the page can act
// on. The device token is the one thing that must never cross that channel.
//
// The hook around it needs React Native; this file runs the plain function
// with every dependency injected, the same way lib/background.test.ts does.

vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("./healthkit", () => ({
  healthDataAvailable: vi.fn(() => true),
  requestPermissions: vi.fn(),
  METRICS: ["steps", "distance_km", "active_calories", "sleep_hours", "sleep_efficiency", "workouts"],
  collectAggregates: vi.fn(),
}));
vi.mock("./background", () => ({ createBackgroundListener: vi.fn() }));

import { NotPairedError, RedeemFailedError, type Pairing } from "./api";
import { HEALTH_UNREADABLE, HealthUnreadableError, type SyncOutcome } from "./sync";
import type { PairStatus } from "./shell/bridge";
import {
  NETWORK_FAILED,
  REVOKED,
  SAVE_FAILED,
  SYNC_DAYS,
  codeSpent,
  runPairPipeline,
  type PipelineDeps,
  type PipelineResult,
} from "./use-apple-pairing";

const TOKEN = "device-token-that-must-never-leak";
const PAIRING: Pairing = { deviceToken: TOKEN, address: "0xabcdef0123456789abcdef0123456789abcdef01" };

function outcome(stored: number, covered: number, daysWithData = stored): SyncOutcome {
  return { sent: stored, daysWithData, coveredDays: [], unread: [], result: { stored, covered } };
}

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps & { emitted: PairStatus[] } {
  const emitted: PairStatus[] = [];
  return {
    redeem: vi.fn(async (_code: string) => PAIRING),
    save: vi.fn(async (_p: Pairing) => undefined),
    connected: false,
    requestPermissions: vi.fn(async () => true),
    saveConnected: vi.fn(async () => undefined),
    listen: vi.fn(async (_p: Pairing) => undefined),
    sync: vi.fn(async (_token: string, _days: number) => outcome(75, 31, 30)),
    emit: (s: PairStatus) => emitted.push(s),
    onStart: vi.fn(),
    onPaired: vi.fn(),
    onConnected: vi.fn(),
    onBusy: vi.fn(),
    attempted: new Set<string>(),
    emitted,
    ...overrides,
  };
}

const statuses = (d: { emitted: PairStatus[] }) => d.emitted.map((s) => s.status);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runPairPipeline", () => {
  it("first pairing: redeem, save, Health sheet, listen, first month, in that order, with every step reported", async () => {
    const d = deps();
    const order: string[] = [];
    (d.onStart as ReturnType<typeof vi.fn>).mockImplementation(() => void order.push("start"));
    (d.redeem as ReturnType<typeof vi.fn>).mockImplementation(async () => (order.push("redeem"), PAIRING));
    (d.save as ReturnType<typeof vi.fn>).mockImplementation(async () => void order.push("save"));
    (d.requestPermissions as ReturnType<typeof vi.fn>).mockImplementation(async () => (order.push("permissions"), true));
    (d.saveConnected as ReturnType<typeof vi.fn>).mockImplementation(async () => void order.push("saveConnected"));
    (d.onConnected as ReturnType<typeof vi.fn>).mockImplementation(() => void order.push("connected"));
    (d.listen as ReturnType<typeof vi.fn>).mockImplementation(async () => void order.push("listen"));
    (d.sync as ReturnType<typeof vi.fn>).mockImplementation(async () => (order.push("sync"), outcome(75, 31, 30)));

    const result = await runPairPipeline("ABCD-EFGH", d);

    expect(order).toEqual(["start", "redeem", "save", "permissions", "saveConnected", "connected", "listen", "sync"]);
    expect(d.redeem).toHaveBeenCalledWith("ABCD-EFGH");
    expect(d.sync).toHaveBeenCalledWith(TOKEN, SYNC_DAYS);
    expect(d.onPaired).toHaveBeenCalledWith(PAIRING);
    expect(statuses(d)).toEqual(["redeeming", "redeemed", "health-sheet", "syncing", "synced"]);
    expect(d.emitted[4]).toEqual({ status: "synced", stored: 75, covered: 31, daysWithData: 30, unread: [] });
    expect(result).toEqual({ ran: true, pairing: PAIRING, connected: true, last: outcome(75, 31, 30), failure: null });
    expect(d.onBusy).toHaveBeenLastCalledWith(null);
  });

  it("a phone that already saw the Health sheet skips it", async () => {
    const d = deps({ connected: true });
    const result = await runPairPipeline("ABCD-EFGH", d);
    expect(d.requestPermissions).not.toHaveBeenCalled();
    expect(d.saveConnected).not.toHaveBeenCalled();
    expect(d.onConnected).not.toHaveBeenCalled();
    expect(statuses(d)).toEqual(["redeeming", "redeemed", "syncing", "synced"]);
    expect(result.connected).toBe(true);
    expect(result.failure).toBeNull();
  });

  it("a code is redeemed once: a repeated post runs nothing instead of burning it into a 400", async () => {
    const d = deps();
    await runPairPipeline("ABCD-EFGH", d);
    const again = await runPairPipeline("ABCD-EFGH", d);
    expect(d.redeem).toHaveBeenCalledTimes(1);
    expect(again.ran).toBe(false);
    expect(d.emitted).toHaveLength(5);
  });

  it("a code that runs nothing never reports a start, so the line from its first try stays on screen", async () => {
    const message = "That code did not work. Codes last ten minutes and work once.";
    const d = deps({ redeem: vi.fn(async () => Promise.reject(new RedeemFailedError(message, 400))) });
    const first = await runPairPipeline("BAD1-BAD2", d);
    expect(d.onStart).toHaveBeenCalledTimes(1);
    expect(first.failure?.message).toBe(message);

    const again = await runPairPipeline("BAD1-BAD2", d);
    expect(again.ran).toBe(false);
    expect(d.onStart).toHaveBeenCalledTimes(1);
    expect(d.onBusy).not.toHaveBeenLastCalledWith("pairing");
    expect(d.emitted).toHaveLength(2);
  });

  it("a refused code (400) fails as invalid-code with the server's line and nothing is saved", async () => {
    const message = "That code did not work. Codes last ten minutes and work once.";
    const d = deps({ redeem: vi.fn(async () => Promise.reject(new RedeemFailedError(message, 400))) });
    const result = await runPairPipeline("BAD1-BAD2", d);
    expect(d.save).not.toHaveBeenCalled();
    expect(d.onPaired).not.toHaveBeenCalled();
    expect(statuses(d)).toEqual(["redeeming", "failed"]);
    expect(d.emitted[1]).toEqual({ status: "failed", reason: "invalid-code", message });
    expect(result.pairing).toBeNull();
    expect(result.failure).toEqual({ message, retry: "pair", reason: "invalid-code" });
    expect(d.attempted.has("BAD1-BAD2")).toBe(true);
  });

  it("a server failure (5xx) on redeem is reported as server, with the server's wording", async () => {
    const d = deps({ redeem: vi.fn(async () => Promise.reject(new RedeemFailedError("Apple pairing is not configured", 503))) });
    const result = await runPairPipeline("ABCD-EFGH", d);
    expect(result.failure).toEqual({ message: "Apple pairing is not configured", retry: "pair", reason: "server" });
  });

  it("a network failure on redeem is reported as network and the code stays retriable", async () => {
    const d = deps({ redeem: vi.fn(async () => Promise.reject(new TypeError("Network request failed"))) });
    const result = await runPairPipeline("ABCD-EFGH", d);
    expect(result.failure).toEqual({ message: NETWORK_FAILED, retry: "pair", reason: "network" });
    expect(d.attempted.has("ABCD-EFGH")).toBe(false);
  });

  it("a Keychain refusal fails as save-failed: the code is spent and the phone holds nothing", async () => {
    const d = deps({ save: vi.fn(async () => Promise.reject(new Error("keychain"))) });
    const result = await runPairPipeline("ABCD-EFGH", d);
    expect(d.onPaired).not.toHaveBeenCalled();
    expect(d.requestPermissions).not.toHaveBeenCalled();
    expect(statuses(d)).toEqual(["redeeming", "redeemed", "failed"]);
    expect(result.pairing).toBeNull();
    expect(result.failure).toEqual({ message: SAVE_FAILED, retry: "pair", reason: "save-failed" });
  });

  it("a Health sheet that could not be shown keeps the pairing and asks for the sheet again", async () => {
    const d = deps({ requestPermissions: vi.fn(async () => Promise.reject(new Error("HealthKit unavailable"))) });
    const result = await runPairPipeline("ABCD-EFGH", d);
    expect(d.onPaired).toHaveBeenCalledWith(PAIRING);
    expect(d.onConnected).not.toHaveBeenCalled();
    expect(d.sync).not.toHaveBeenCalled();
    expect(statuses(d)).toEqual(["redeeming", "redeemed", "health-sheet", "failed"]);
    expect(result).toEqual({
      ran: true,
      pairing: PAIRING,
      connected: false,
      last: null,
      failure: { message: "HealthKit unavailable", retry: "connect", reason: "health-unreadable" },
    });
  });

  it("a read HealthKit refused keeps the pairing and retries the sync", async () => {
    const d = deps({ connected: true, sync: vi.fn(async () => Promise.reject(new HealthUnreadableError())) });
    const result = await runPairPipeline("ABCD-EFGH", d);
    expect(d.emitted.at(-1)).toEqual({ status: "failed", reason: "health-unreadable", message: HEALTH_UNREADABLE });
    expect(result.pairing).toEqual(PAIRING);
    expect(result.failure).toEqual({ message: HEALTH_UNREADABLE, retry: "sync", reason: "health-unreadable" });
  });

  it("a sync the server answers 401 means another phone paired: the pairing is dropped as revoked", async () => {
    const d = deps({ connected: true, sync: vi.fn(async () => Promise.reject(new NotPairedError("not paired"))) });
    const result = await runPairPipeline("ABCD-EFGH", d);
    expect(d.emitted.at(-1)).toEqual({ status: "failed", reason: "revoked", message: REVOKED });
    expect(result.pairing).toBeNull();
    expect(result.failure).toEqual({ message: REVOKED, retry: "pair", reason: "revoked" });
  });

  it("a sync the server stored nothing from is still reported as synced with zeros, never as paired", async () => {
    const d = deps({ connected: true, sync: vi.fn(async () => outcome(0, 0)) });
    const result = await runPairPipeline("ABCD-EFGH", d);
    expect(d.emitted.at(-1)).toEqual({ status: "synced", stored: 0, covered: 0, daysWithData: 0, unread: [] });
    expect(result.last).toEqual(outcome(0, 0));
  });

  it("a listener that fails to start never stops the first sync", async () => {
    const d = deps({ connected: true, listen: vi.fn(async () => Promise.reject(new Error("observer"))) });
    const result = await runPairPipeline("ABCD-EFGH", d);
    expect(d.sync).toHaveBeenCalledTimes(1);
    expect(result.failure).toBeNull();
  });

  it("neither the device token nor the code ever reaches a pair-status event or the console", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const d = deps();
    await runPairPipeline("ABCD-EFGH", d);
    const failing = deps({ sync: vi.fn(async () => Promise.reject(new NotPairedError("not paired"))) });
    await runPairPipeline("WXYZ-1234", failing);

    const everything = JSON.stringify([...d.emitted, ...failing.emitted]);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain("ABCD-EFGH");
    expect(everything).not.toContain("WXYZ-1234");
    for (const spy of [warn, log, error]) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
      expect(JSON.stringify(spy.mock.calls)).not.toContain("ABCD-EFGH");
      spy.mockRestore();
    }
  });
});

// Whether the code behind a result is gone for good. The root keeps the last
// Safari-link code for the fallback screen's field; a spent code offered
// there again would wipe the line that says why it failed and do nothing.
describe("codeSpent", () => {
  const ran = (failure: PipelineResult["failure"]): PipelineResult => ({
    ran: true,
    pairing: failure === null ? PAIRING : null,
    connected: true,
    last: null,
    failure,
  });

  it("a code that paired is spent", () => {
    expect(codeSpent(ran(null))).toBe(true);
  });

  it("a code the server refused, or whose token the Keychain lost, is spent", () => {
    expect(codeSpent(ran({ message: "nope", retry: "pair", reason: "invalid-code" }))).toBe(true);
    expect(codeSpent(ran({ message: SAVE_FAILED, retry: "pair", reason: "save-failed" }))).toBe(true);
    expect(codeSpent(ran({ message: REVOKED, retry: "pair", reason: "revoked" }))).toBe(true);
  });

  it("a code the network dropped is not spent: the same code can be tried again", () => {
    expect(codeSpent(ran({ message: NETWORK_FAILED, retry: "pair", reason: "network" }))).toBe(false);
  });

  it("an empty or already-tried code decides nothing", () => {
    expect(codeSpent(null)).toBe(false);
    expect(codeSpent({ ran: false, pairing: null, connected: false, last: null, failure: null })).toBe(false);
  });
});
