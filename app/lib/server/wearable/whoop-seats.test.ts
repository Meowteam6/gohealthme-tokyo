import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// WHOOP's sandbox app admits 10 members. Seats are first come, first served,
// with the reserved wallets (WHOOP_ALLOWED_WALLETS) always admitted and kept
// out of the open pool, so nobody has to ask and nobody hits WHOOP's cap.

let seats: string[] = [];
vi.mock("@/lib/server/store", () => ({
  readJsonList: async () => [...seats],
  appendJson: async (_f: string, entry: string) => {
    seats.push(entry);
  },
}));

const { whoopSeatStatus, claimWhoopSeat } = await import("@/lib/server/wearable/whoop-seats");

const RESERVED = "0x8a39a5160Bad34713169ad7eEf9bd779b32c6141";
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

beforeEach(() => {
  seats = [];
  vi.stubEnv("WHOOP_ALLOWED_WALLETS", RESERVED);
  vi.stubEnv("WHOOP_SEAT_LIMIT", "3");
});
afterEach(() => vi.unstubAllEnvs());

describe("WHOOP seats", () => {
  it("admits anyone while open seats remain, and counts them down", async () => {
    expect(await whoopSeatStatus(addr(1))).toEqual({ allowed: true, seatsLeft: 2 });
    await claimWhoopSeat(addr(1));
    expect(await whoopSeatStatus(addr(2))).toEqual({ allowed: true, seatsLeft: 1 });
  });

  it("refuses a new wallet once open seats are full, but never a reserved one", async () => {
    await claimWhoopSeat(addr(1));
    await claimWhoopSeat(addr(2));
    expect((await whoopSeatStatus(addr(3))).allowed).toBe(false);
    expect((await whoopSeatStatus(RESERVED.toLowerCase())).allowed).toBe(true);
  });

  it("a wallet that holds a seat keeps it and claiming twice does not use another", async () => {
    await claimWhoopSeat(addr(1));
    await claimWhoopSeat(addr(1).toUpperCase().replace("0X", "0x"));
    await claimWhoopSeat(addr(2));
    expect((await whoopSeatStatus(addr(1))).allowed).toBe(true);
    expect((await whoopSeatStatus(addr(9))).allowed).toBe(false);
  });

  it("a reserved wallet linking does not use an open seat", async () => {
    await claimWhoopSeat(RESERVED);
    expect(await whoopSeatStatus(addr(1))).toEqual({ allowed: true, seatsLeft: 2 });
  });

  it("defaults to WHOOP's 10-member cap and refuses a null address", async () => {
    vi.stubEnv("WHOOP_SEAT_LIMIT", "");
    expect(await whoopSeatStatus(addr(1))).toEqual({ allowed: true, seatsLeft: 9 });
    expect((await whoopSeatStatus(null)).allowed).toBe(false);
  });
});
