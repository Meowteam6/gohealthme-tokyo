import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";

// The three approval routes (World ID for Agents, ETHGlobal Tokyo 2026).
// Pinned here: request and complete refuse an unsigned caller and a signer
// who is not the claim's participant; request needs a pay decision and no
// record; the full journey request -> complete(approve) -> status approved;
// the denied journey complete(decline) -> status declined; a wrong-action
// proof is 401 and the request stays pending; expiry surfaces through status;
// mode off is an honest 409; world mode without env is an honest 503.

const USER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const GOAL = "0x" + "ab".repeat(32);

let signer: { ok: true; address: string } | { ok: false; reason: string } = {
  ok: false,
  reason: "missing wallet signature headers",
};

vi.mock("@/lib/server/wallet-auth", () => ({
  authenticateWallet: vi.fn(async () => signer),
}));

// The request route reads the pool's settled flag from chain before opening a
// request. Tests flip these to model a settled pool or an RPC failure.
let poolSettled = false;
let poolReadFails = false;
vi.mock("@/lib/server/agent/spotter", () => ({
  arcReader: vi.fn(() => ({
    getPoolState: vi.fn(async () => {
      if (poolReadFails) throw new Error("rpc down");
      return { settled: poolSettled, periodEnd: 0n, periodStart: 0n };
    }),
  })),
}));

async function load() {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "approval-routes-")));
  vi.resetModules();
  const request = await import("@/app/api/agent/approval/request/route");
  const complete = await import("@/app/api/agent/approval/complete/route");
  const status = await import("@/app/api/agent/approval/status/route");
  const ledger = await import("@/lib/server/agent/ledger");
  const provider = await import("@/lib/server/agent/approval-provider");
  return {
    requestRoute: request.POST,
    completeRoute: complete.POST,
    statusRoute: status.GET,
    ...ledger,
    ...provider,
  };
}

function post(url: string, body: unknown) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedPayDecision(appendLedger: Awaited<ReturnType<typeof load>>["appendLedger"]) {
  await appendLedger(GOAL, {
    kind: "plan",
    steps: [{ service: "attester-read", label: "read", estUsd: "0.02" }],
    capUsd: "1.00",
    poolId: "7",
    participant: USER,
  });
  await appendLedger(GOAL, {
    kind: "verdict",
    verified: true,
    confidence: "high",
    reason: "on record",
    ref: "job-1",
  });
  await appendLedger(GOAL, { kind: "reason", decision: "pay", note: "paying.", ref: "job-1" });
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  signer = { ok: false, reason: "missing wallet signature headers" };
  poolSettled = false;
  poolReadFails = false;
});

describe("POST /api/agent/approval/request", () => {
  it("refuses an unsigned caller with 401 before reading anything", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { requestRoute } = await load();
    const response = await requestRoute(post("/api/agent/approval/request", { goalId: GOAL }));
    expect(response.status).toBe(401);
  });

  it("refuses a signer who is not the participant with 403", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { requestRoute, appendLedger } = await load();
    await seedPayDecision(appendLedger);
    signer = { ok: true, address: OTHER };
    const response = await requestRoute(post("/api/agent/approval/request", { goalId: GOAL }));
    expect(response.status).toBe(403);
  });

  it("is an honest 409 when the mode is off", async () => {
    const { requestRoute } = await load();
    signer = { ok: true, address: USER };
    const response = await requestRoute(post("/api/agent/approval/request", { goalId: GOAL }));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toMatch(/does not ask for a World ID confirmation/);
  });

  it("needs a claim with a pay decision and no record", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { requestRoute, appendLedger } = await load();
    signer = { ok: true, address: USER };
    expect(
      (await requestRoute(post("/api/agent/approval/request", { goalId: GOAL }))).status,
    ).toBe(404);
    await appendLedger(GOAL, {
      kind: "plan",
      steps: [],
      capUsd: "1.00",
      poolId: "7",
      participant: USER,
    });
    await appendLedger(GOAL, { kind: "reason", decision: "no-pay", note: "no.", ref: "job-1" });
    expect(
      (await requestRoute(post("/api/agent/approval/request", { goalId: GOAL }))).status,
    ).toBe(409);
  });

  it("refuses with 409 code settled once the pool settled, opening nothing", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { requestRoute, appendLedger, readLedger } = await load();
    await seedPayDecision(appendLedger);
    signer = { ok: true, address: USER };
    poolSettled = true;
    const before = (await readLedger(GOAL)).length;
    const response = await requestRoute(post("/api/agent/approval/request", { goalId: GOAL }));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; code?: string };
    expect(body.code).toBe("settled");
    expect(body.error).toMatch(/already settled/);
    // No request row: nothing to confirm on a settled run.
    expect(await readLedger(GOAL)).toHaveLength(before);
  });

  it("fails closed with a retryable 503 when the pool state cannot be read", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { requestRoute, appendLedger } = await load();
    await seedPayDecision(appendLedger);
    signer = { ok: true, address: USER };
    poolReadFails = true;
    const response = await requestRoute(post("/api/agent/approval/request", { goalId: GOAL }));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).not.toMatch(/rpc down/);
  });

  it("world mode without env is an honest 503, never a mock fallback", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "world");
    const { requestRoute, appendLedger } = await load();
    await seedPayDecision(appendLedger);
    signer = { ok: true, address: USER };
    const response = await requestRoute(post("/api/agent/approval/request", { goalId: GOAL }));
    expect(response.status).toBe(503);
    const error = ((await response.json()) as { error: string }).error;
    // Player copy only: the missing setting goes to the server log.
    expect(error).toMatch(/paused/i);
    expect(error).not.toMatch(/WORLD_|NEXT_PUBLIC|env/);
  });
});

describe("the complete journey", () => {
  it("request -> approve with a mocked proof -> status approved, one human one consent", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { requestRoute, completeRoute, statusRoute, appendLedger, readLedger, MOCK_PROOF_KIND } =
      await load();
    await seedPayDecision(appendLedger);
    signer = { ok: true, address: USER };

    const opened = await requestRoute(post("/api/agent/approval/request", { goalId: GOAL }));
    expect(opened.status).toBe(200);
    const request = (await opened.json()) as {
      requestId: string;
      expiresAt: string;
      action: string;
      signal: string;
      provider: string;
      mocked: boolean;
      world?: unknown;
    };
    expect(request.provider).toBe("mock");
    expect(request.action).toBe("settle");
    expect(request.signal).toBe(`${GOAL.toLowerCase()}:1`);
    expect(request.mocked).toBe(true);
    expect(request.world).toBeUndefined();
    expect(Date.parse(request.expiresAt) - Date.now()).toBeLessThanOrEqual(90_000);

    const pending = await statusRoute(
      new Request(`http://localhost/api/agent/approval/status?goalId=${GOAL}`),
    );
    expect(await pending.json()).toMatchObject({ status: "pending", requestId: request.requestId, mocked: true });

    const done = await completeRoute(
      post("/api/agent/approval/complete", {
        requestId: request.requestId,
        proof: { kind: MOCK_PROOF_KIND, action: request.action, signal: request.signal, approve: true },
      }),
    );
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ status: "approved" });

    const after = await statusRoute(
      new Request(`http://localhost/api/agent/approval/status?goalId=${GOAL}`),
    );
    expect(await after.json()).toMatchObject({ status: "approved" });
    const rows = await readLedger(GOAL);
    expect(rows.slice(-2).map((r) => (r.kind === "approval" ? r.status : r.kind))).toEqual([
      "requested",
      "approved",
    ]);
  });

  it("request -> decline -> status declined, and a late approve changes nothing", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { requestRoute, completeRoute, statusRoute, appendLedger, MOCK_PROOF_KIND } = await load();
    await seedPayDecision(appendLedger);
    signer = { ok: true, address: USER };
    const request = (await (
      await requestRoute(post("/api/agent/approval/request", { goalId: GOAL }))
    ).json()) as { requestId: string; action: string; signal: string };

    const declined = await completeRoute(
      post("/api/agent/approval/complete", { requestId: request.requestId, decline: true }),
    );
    expect(await declined.json()).toEqual({ status: "declined" });
    const late = await completeRoute(
      post("/api/agent/approval/complete", {
        requestId: request.requestId,
        proof: { kind: MOCK_PROOF_KIND, action: request.action, signal: request.signal, approve: true },
      }),
    );
    expect(await late.json()).toEqual({ status: "declined" });
    const status = await statusRoute(
      new Request(`http://localhost/api/agent/approval/status?goalId=${GOAL}`),
    );
    expect(await status.json()).toMatchObject({ status: "declined" });
  });

  it("a proof for the wrong action is 401 and the request stays pending", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { requestRoute, completeRoute, statusRoute, appendLedger, MOCK_PROOF_KIND } = await load();
    await seedPayDecision(appendLedger);
    signer = { ok: true, address: USER };
    const request = (await (
      await requestRoute(post("/api/agent/approval/request", { goalId: GOAL }))
    ).json()) as { requestId: string; action: string; signal: string };
    const bad = await completeRoute(
      post("/api/agent/approval/complete", {
        requestId: request.requestId,
        proof: { kind: MOCK_PROOF_KIND, action: "prove-human", signal: request.signal, approve: true },
      }),
    );
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ status: "pending", error: /Not confirmed/ });
    const status = await statusRoute(
      new Request(`http://localhost/api/agent/approval/status?goalId=${GOAL}`),
    );
    expect(await status.json()).toMatchObject({ status: "pending" });
  });

  it("complete refuses an unsigned caller (401), a stranger (403), and an unknown id (404)", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { requestRoute, completeRoute, appendLedger } = await load();
    await seedPayDecision(appendLedger);
    signer = { ok: true, address: USER };
    const request = (await (
      await requestRoute(post("/api/agent/approval/request", { goalId: GOAL }))
    ).json()) as { requestId: string };

    signer = { ok: false, reason: "nope" };
    expect(
      (await completeRoute(post("/api/agent/approval/complete", { requestId: request.requestId, decline: true }))).status,
    ).toBe(401);
    signer = { ok: true, address: OTHER };
    expect(
      (await completeRoute(post("/api/agent/approval/complete", { requestId: request.requestId, decline: true }))).status,
    ).toBe(403);
    signer = { ok: true, address: USER };
    expect(
      (await completeRoute(post("/api/agent/approval/complete", { requestId: "apr_00000000-0000-0000-0000-000000000000", decline: true }))).status,
    ).toBe(404);
  });

  it("expiry surfaces through status, and asking again opens attempt 2", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    vi.stubEnv("WORLD_APPROVAL_TTL_S", "10");
    const { requestRoute, statusRoute, appendLedger } = await load();
    await seedPayDecision(appendLedger);
    signer = { ok: true, address: USER };
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.parse("2026-09-26T03:00:00.000Z"));
      const first = (await (
        await requestRoute(post("/api/agent/approval/request", { goalId: GOAL }))
      ).json()) as { requestId: string; attempt: number };
      vi.setSystemTime(Date.parse("2026-09-26T03:00:11.000Z"));
      const expired = await statusRoute(
        new Request(`http://localhost/api/agent/approval/status?goalId=${GOAL}`),
      );
      expect(await expired.json()).toMatchObject({ status: "expired", requestId: first.requestId });
      const second = (await (
        await requestRoute(post("/api/agent/approval/request", { goalId: GOAL }))
      ).json()) as { requestId: string; attempt: number; status: string };
      expect(second.attempt).toBe(2);
      expect(second.status).toBe("pending");
      expect(second.requestId).not.toBe(first.requestId);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("GET /api/agent/approval/status", () => {
  it("answers none for a goal SPOTTER never asked about, with the mode", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    const { statusRoute } = await load();
    const response = await statusRoute(
      new Request(`http://localhost/api/agent/approval/status?goalId=${GOAL}`),
    );
    expect(await response.json()).toEqual({ status: "none", mode: "mock" });
  });

  it("answers off when the human step is not switched on", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "");
    const { statusRoute } = await load();
    const response = await statusRoute(
      new Request(`http://localhost/api/agent/approval/status?goalId=${GOAL}`),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "none", mode: "off" });
  });

  it("reports misconfigured, not off, when the mode value is bad", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "wrld");
    const { statusRoute } = await load();
    const response = await statusRoute(
      new Request(`http://localhost/api/agent/approval/status?goalId=${GOAL}`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.mode).toBe("misconfigured");
    expect(JSON.stringify(body)).not.toMatch(/WORLD_|wrld/);
  });

  it("reports misconfigured when world mode is on without its credentials", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "world");
    vi.stubEnv("NEXT_PUBLIC_WORLD_APP_ID", "");
    vi.stubEnv("WORLD_RP_ID", "");
    vi.stubEnv("WORLD_SIGNING_KEY", "");
    const { statusRoute } = await load();
    const response = await statusRoute(
      new Request(`http://localhost/api/agent/approval/status?goalId=${GOAL}`),
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { mode: string }).mode).toBe("misconfigured");
  });

  it("reports misconfigured when mock is set on a production deployment", async () => {
    vi.stubEnv("WORLD_APPROVAL_MODE", "mock");
    vi.stubEnv("VERCEL_ENV", "production");
    const { statusRoute } = await load();
    const response = await statusRoute(
      new Request(`http://localhost/api/agent/approval/status?goalId=${GOAL}`),
    );
    expect(((await response.json()) as { mode: string }).mode).toBe("misconfigured");
  });

  it("validates the goalId", async () => {
    const { statusRoute } = await load();
    const response = await statusRoute(
      new Request("http://localhost/api/agent/approval/status?goalId=nope"),
    );
    expect(response.status).toBe(400);
  });
});
