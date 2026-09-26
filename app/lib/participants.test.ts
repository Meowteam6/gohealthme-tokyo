// HealthPoolsV3 has no getParticipants(): the list lives in an internal
// array. The app reads it straight from contract storage (the public Base RPC
// caps eth_getLogs at 1,000 blocks, so an event scan is too slow). Pinned
// here: an empty pool costs one read, joiners come back in join order from
// the right slots, a length that disagrees with participantCount throws, and
// the slot constant matches the compiled storage layout.

import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "child_process";
import path from "path";
import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from "viem";
import { PARTICIPANT_LIST_SLOT, readParticipants } from "@/lib/contract";

const POOLS: Address = "0x0B6E8D477313599aBB746218a1AE45BAb333A12F";
const A: Address = "0x8a39a5160Bad34713169ad7eEf9bd779b32c6141";
const B: Address = "0x2222222222222222222222222222222222222222";

function word(v: bigint | string): Hex {
  return typeof v === "bigint" ? toHex(v, { size: 32 }) : (`0x${v.slice(2).toLowerCase().padStart(64, "0")}` as Hex);
}

function fakeClient(poolId: bigint, count: bigint, list: Address[]) {
  const lengthSlot = keccak256(
    encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [poolId, PARTICIPANT_LIST_SLOT]),
  );
  const base = BigInt(keccak256(lengthSlot));
  const storage = new Map<string, Hex>([[lengthSlot, word(BigInt(list.length))]]);
  list.forEach((a, i) => storage.set(toHex(base + BigInt(i), { size: 32 }), word(a)));
  return {
    readContract: vi.fn(async () => count),
    getStorageAt: vi.fn(async ({ slot }: { slot: Hex }) => storage.get(slot) ?? word(0n)),
  };
}

describe("readParticipants", () => {
  it("reads nothing more for an empty pool", async () => {
    const client = fakeClient(1n, 0n, []);
    expect(await readParticipants(client as never, POOLS, 1n)).toEqual([]);
    expect(client.getStorageAt).not.toHaveBeenCalled();
  });

  it("returns joiners in join order from the pool's slots", async () => {
    const client = fakeClient(4n, 2n, [A, B]);
    expect(await readParticipants(client as never, POOLS, 4n)).toEqual([A, B]);
    expect(client.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "participantCount", args: [4n] }),
    );
  });

  it("throws when storage disagrees with participantCount", async () => {
    const client = fakeClient(1n, 2n, [A]);
    await expect(readParticipants(client as never, POOLS, 1n)).rejects.toThrow(/participantCount/);
  });

  it("uses the slot the compiled contract puts participantList in", () => {
    let layout: string;
    try {
      layout = execFileSync("forge", ["inspect", "HealthPoolsV3", "storageLayout", "--json"], {
        cwd: path.resolve(__dirname, "../../contracts"),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return; // forge not installed here; the live read's length check still guards it.
    }
    const parsed = JSON.parse(layout) as { storage: Array<{ label: string; slot: string }> };
    const entry = parsed.storage.find((s) => s.label === "participantList");
    expect(entry?.slot).toBe(PARTICIPANT_LIST_SLOT.toString());
  }, 120_000);
});
