import { describe, expect, it } from "vitest";
import { withRetry } from "@/lib/world/retry";

const noWait = async (): Promise<void> => {};

describe("withRetry (prove-human status read)", () => {
  it("returns the first answer without waiting", async () => {
    const waits: number[] = [];
    const value = await withRetry(async () => "ok", {
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    expect(value).toBe("ok");
    expect(waits).toEqual([]);
  });

  it("absorbs a transient failure", async () => {
    let calls = 0;
    const value = await withRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error("status answered 500");
        return "verified";
      },
      { delaysMs: [1, 1], wait: noWait },
    );
    expect(value).toBe("verified");
    expect(calls).toBe(2);
  });

  it("rejects with the last error once the retries are spent", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error(`fail ${calls}`);
        },
        { delaysMs: [1, 1], wait: noWait },
      ),
    ).rejects.toThrow("fail 3");
    expect(calls).toBe(3);
  });

  it("stops retrying when the caller no longer wants the answer", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("down");
        },
        { delaysMs: [1, 1], wait: noWait, shouldStop: () => true },
      ),
    ).rejects.toThrow("down");
    expect(calls).toBe(1);
  });
});
