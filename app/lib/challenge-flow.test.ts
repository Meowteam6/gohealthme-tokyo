import { describe, it, expect, vi } from "vitest";
import type { Hex } from "viem";
import {
  HEALTH_UNREACHABLE_MESSAGE,
  fetchChallengesHealth,
  runDareFlow,
  type DareFlowSteps,
  type FundedDare,
} from "@/lib/challenge-flow";

const HASH = ("0x" + "ab".repeat(32)) as Hex;
const TOKEN = "T".repeat(32);

function steps(overrides: Partial<DareFlowSteps> = {}) {
  const s = {
    checkHealth: vi.fn(async () => ({ ok: true as const })),
    deposit: vi.fn(async () => HASH),
    resolvePoolId: vi.fn(async () => 9n),
    mintLink: vi.fn(async () => ({ ok: true as const, token: TOKEN })),
    onFunded: vi.fn(),
    onLinking: vi.fn(),
    ...overrides,
  };
  return s;
}

describe("runDareFlow, fresh dare", () => {
  it("runs preflight, deposit, pool lookup and link in order", async () => {
    const s = steps();
    const result = await runDareFlow(s, null);
    expect(result).toEqual({ kind: "done", poolId: 9n, token: TOKEN });
    expect(s.deposit).toHaveBeenCalledTimes(1);
    expect(s.mintLink).toHaveBeenCalledWith(9n);
    expect(s.onFunded).toHaveBeenLastCalledWith({ depositHash: HASH, poolId: 9n });
  });

  it("refuses before the deposit when the store preflight says no", async () => {
    const s = steps({
      checkHealth: vi.fn(async () => ({
        ok: false as const,
        message: "Challenges are not live on this build yet. Nothing was charged.",
      })),
    });
    const result = await runDareFlow(s, null);
    expect(result).toEqual({
      kind: "unavailable",
      message: "Challenges are not live on this build yet. Nothing was charged.",
    });
    expect(s.deposit).not.toHaveBeenCalled();
    expect(s.onFunded).not.toHaveBeenCalled();
  });

  it("refuses before the deposit when the preflight cannot be reached", async () => {
    const s = steps({
      checkHealth: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const result = await runDareFlow(s, null);
    expect(result).toEqual({ kind: "unavailable", message: HEALTH_UNREACHABLE_MESSAGE });
    expect(s.deposit).not.toHaveBeenCalled();
  });

  it("a failed deposit is depositFailed, never a 'reward is up' link failure", async () => {
    const s = steps({
      deposit: vi.fn(async () => {
        throw new Error("user rejected");
      }),
    });
    const result = await runDareFlow(s, null);
    expect(result).toEqual({ kind: "depositFailed" });
    expect(s.onFunded).not.toHaveBeenCalled();
    expect(s.mintLink).not.toHaveBeenCalled();
  });

  it("records the funded dare before the pool lookup can fail", async () => {
    const s = steps({
      resolvePoolId: vi.fn(async () => {
        throw new Error("receipt not found");
      }),
    });
    const result = await runDareFlow(s, null);
    expect(result.kind).toBe("linkFailed");
    if (result.kind === "linkFailed") {
      expect(result.funded).toEqual({ depositHash: HASH, poolId: null });
    }
    expect(s.onFunded).toHaveBeenCalledWith({ depositHash: HASH, poolId: null });
  });

  it("a refused link after a landed deposit keeps the pool for a link-only retry", async () => {
    const s = steps({
      mintLink: vi.fn(async () => ({ ok: false as const, message: "Sign to send it." })),
    });
    const result = await runDareFlow(s, null);
    expect(result).toEqual({
      kind: "linkFailed",
      funded: { depositHash: HASH, poolId: 9n },
      message: "Sign to send it.",
    });
  });

  it("a thrown or empty link is a link failure with the pool kept", async () => {
    const thrown = await runDareFlow(
      steps({
        mintLink: vi.fn(async () => {
          throw new Error("network");
        }),
      }),
      null,
    );
    expect(thrown.kind).toBe("linkFailed");
    const empty = await runDareFlow(
      steps({ mintLink: vi.fn(async () => ({ ok: true as const, token: "" })) }),
      null,
    );
    expect(empty.kind).toBe("linkFailed");
  });
});

describe("runDareFlow, link-only retry", () => {
  it("never deposits again when the pool is known", async () => {
    const s = steps();
    const funded: FundedDare = { depositHash: HASH, poolId: 4n };
    const result = await runDareFlow(s, funded);
    expect(result).toEqual({ kind: "done", poolId: 4n, token: TOKEN });
    expect(s.checkHealth).not.toHaveBeenCalled();
    expect(s.deposit).not.toHaveBeenCalled();
    expect(s.resolvePoolId).not.toHaveBeenCalled();
    expect(s.mintLink).toHaveBeenCalledWith(4n);
  });

  it("re-resolves the pool id without depositing when it was not found yet", async () => {
    const s = steps();
    const result = await runDareFlow(s, { depositHash: HASH, poolId: null });
    expect(result).toEqual({ kind: "done", poolId: 9n, token: TOKEN });
    expect(s.deposit).not.toHaveBeenCalled();
    expect(s.resolvePoolId).toHaveBeenCalledWith(HASH);
  });
});

describe("fetchChallengesHealth", () => {
  it("maps 200 to ok", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    expect(await fetchChallengesHealth(fetchImpl as unknown as typeof fetch)).toEqual({
      ok: true,
    });
  });

  it("carries the server's player copy on a 503", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: "Challenges are off." }), {
          status: 503,
        }),
    );
    expect(await fetchChallengesHealth(fetchImpl as unknown as typeof fetch)).toEqual({
      ok: false,
      message: "Challenges are off.",
    });
  });

  it("falls back to plain copy when the body is not JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 502 }));
    expect(await fetchChallengesHealth(fetchImpl as unknown as typeof fetch)).toEqual({
      ok: false,
      message: HEALTH_UNREACHABLE_MESSAGE,
    });
  });
});
