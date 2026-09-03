import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolInfo } from "@/lib/contract";

// The pool detail page itself is a client component tree; only the head
// metadata is under test here, so the component and the chain read are
// stubbed. The three branches matter for crawlers: a public pool gets a
// goal title, a testnet description and its own canonical; a challenge is
// noindex with no goal text anywhere in the head; a failure falls back to
// the bare app name with no canonical pointing at the pool list.

vi.mock("@/components/PoolDetail", () => ({ default: () => null }));

const fetchPool = vi.fn<(id: bigint) => Promise<PoolInfo>>();
vi.mock("@/lib/contract", () => ({
  fetchPool: (id: bigint) => fetchPool(id),
  displayGoalSpec: (goalSpec: string) => goalSpec,
}));

const { generateMetadata } = await import("./page");

function pool(overrides: Partial<PoolInfo>): PoolInfo {
  return {
    id: 1n,
    creator: "0x0000000000000000000000000000000000000001",
    bountyModel: 2,
    settled: false,
    cancelled: false,
    periodStart: 0n,
    periodEnd: 0n,
    entryFee: 0n,
    balance: 0n,
    initiative: "sleep",
    goalSpec: "Sleep at least 7 hours nightly for a week",
    ...overrides,
  };
}

async function metadataFor(id: string) {
  return generateMetadata({ params: Promise.resolve({ id }) });
}

beforeEach(() => {
  fetchPool.mockReset();
});

describe("pool detail metadata", () => {
  it("gives a public pool a goal title, a testnet description and its own canonical", async () => {
    fetchPool.mockResolvedValue(pool({}));
    const meta = await metadataFor("1");
    expect(meta.title).toBe("Sleep at least 7 hours nightly for a week");
    expect(meta.description).toContain("Sleep at least 7 hours nightly for a week");
    expect(meta.description).toMatch(/testnet/i);
    expect(meta.alternates?.canonical).toBe("/pools/1");
    expect(meta.robots).toBeUndefined();
  });

  it("normalises the canonical to the numeric id", async () => {
    fetchPool.mockResolvedValue(pool({}));
    const meta = await metadataFor("007");
    expect(meta.alternates?.canonical).toBe("/pools/7");
  });

  it("keeps a challenge out of the index and out of the head entirely", async () => {
    fetchPool.mockResolvedValue(
      pool({ initiative: "challenge", goalSpec: "Private dare text" }),
    );
    const meta = await metadataFor("3");
    expect(meta.title).toBe("Private challenge");
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates?.canonical).toBeNull();
    expect(JSON.stringify(meta)).not.toContain("Private dare text");
  });

  it("falls back to the bare app name with no canonical when the read fails", async () => {
    fetchPool.mockRejectedValue(new Error("rpc down"));
    const meta = await metadataFor("1");
    expect(meta.title).toEqual({ absolute: "GoHealthMe" });
    expect(meta.alternates?.canonical).toBeNull();
    expect(meta.description).toBeUndefined();
  });

  it("treats a non-positive id as a fallback without touching the chain", async () => {
    const meta = await metadataFor("0");
    expect(meta.title).toEqual({ absolute: "GoHealthMe" });
    expect(fetchPool).not.toHaveBeenCalled();
  });
});
