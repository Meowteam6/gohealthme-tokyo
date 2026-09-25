import { describe, it, expect, beforeEach, vi } from "vitest";

// The challenges store is the link half of a dare whose money half has already
// moved on chain. These tests pin the two things that must not drift: every
// read and write is scoped to this deployment's HealthPoolsV3 address (V3 rows
// never reach a V4 pool), and the preflight refuses whenever the row could not
// be written, so the form stops before the deposit.

interface Call {
  op: string;
  args: unknown[];
}

interface FakeResult {
  data: unknown;
  error: { code?: string; message?: string; details?: string } | null;
}

/** A chainable stand-in for the supabase-js query builder. Every call is
 *  recorded; awaiting it (or maybeSingle) resolves to the next queued result. */
function fakeClient(results: FakeResult[]) {
  const calls: Call[] = [];
  const next = (): FakeResult => results.shift() ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const op of ["from", "select", "eq", "in", "limit", "insert"]) {
    builder[op] = (...args: unknown[]) => {
      calls.push({ op, args });
      return builder;
    };
  }
  builder.maybeSingle = () => {
    calls.push({ op: "maybeSingle", args: [] });
    return Promise.resolve(next());
  };
  builder.then = (
    resolve: (value: FakeResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(next()).then(resolve, reject);
  return { client: builder, calls };
}

const V4 = "0xAbCdEf0000000000000000000000000000000004";
const V4_LOWER = V4.toLowerCase();
const V3 = "0x66815e3AC541eB18d01D2aed25D0D9779583D832";
const CHALLENGER = "0x1111111111111111111111111111111111111111";
const TOKEN = "A".repeat(32);

let client: ReturnType<typeof fakeClient>;
let writeConfigured = true;

vi.mock("@/lib/server/supabase", () => ({
  getSupabaseServiceRole: () => (writeConfigured ? client.client : null),
  supabaseWriteConfigured: () => writeConfigured,
}));

async function load() {
  vi.resetModules();
  return await import("@/lib/server/challenges");
}

function eqs(calls: Call[]): Array<[unknown, unknown]> {
  return calls
    .filter((c) => c.op === "eq")
    .map((c) => [c.args[0], c.args[1]] as [unknown, unknown]);
}

beforeEach(() => {
  vi.unstubAllEnvs();
  writeConfigured = true;
  vi.stubEnv("HEALTH_POOLS_ADDRESS", V4);
  vi.stubEnv("NEXT_PUBLIC_HEALTH_POOLS_ADDRESS", V4);
});

describe("challengesContract", () => {
  it("lowercases the configured address", async () => {
    const mod = await load();
    expect(mod.challengesContract()).toEqual({ ok: true, contract: V4_LOWER });
  });

  it("accepts either address alone", async () => {
    const mod = await load();
    expect(mod.challengesContract({ HEALTH_POOLS_ADDRESS: V4 })).toEqual({
      ok: true,
      contract: V4_LOWER,
    });
    expect(
      mod.challengesContract({ NEXT_PUBLIC_HEALTH_POOLS_ADDRESS: V4 }),
    ).toEqual({ ok: true, contract: V4_LOWER });
  });

  it("refuses when no address is configured", async () => {
    const mod = await load();
    expect(mod.challengesContract({})).toEqual({
      ok: false,
      code: "no-pools-address",
    });
    expect(mod.challengesContract({ HEALTH_POOLS_ADDRESS: "0xnope" })).toEqual({
      ok: false,
      code: "no-pools-address",
    });
  });

  it("refuses when the server and browser addresses disagree", async () => {
    const mod = await load();
    expect(
      mod.challengesContract({
        HEALTH_POOLS_ADDRESS: V4,
        NEXT_PUBLIC_HEALTH_POOLS_ADDRESS: V3,
      }),
    ).toEqual({ ok: false, code: "pools-address-mismatch" });
  });
});

describe("checkChallengesHealth (the pre-deposit preflight)", () => {
  it("is ok when the scoped probe succeeds, and probes the contract column", async () => {
    client = fakeClient([{ data: null, error: null }]);
    const mod = await load();
    const health = await mod.checkChallengesHealth();
    expect(health).toEqual({ ok: true, contract: V4_LOWER });
    const select = client.calls.find((c) => c.op === "select");
    expect(String(select?.args[0])).toContain("contract_address");
    expect(eqs(client.calls)).toContainEqual(["contract_address", V4_LOWER]);
  });

  it("refuses when the table or column is missing (not migrated)", async () => {
    client = fakeClient([
      { data: null, error: { code: "42703", message: "column does not exist" } },
    ]);
    const mod = await load();
    expect(await mod.checkChallengesHealth()).toEqual({
      ok: false,
      code: "unreachable",
    });
  });

  it("refuses when Supabase is not configured", async () => {
    writeConfigured = false;
    client = fakeClient([]);
    const mod = await load();
    expect(await mod.checkChallengesHealth()).toEqual({
      ok: false,
      code: "no-database",
    });
  });

  it("refuses when the pools address is missing, before touching Supabase", async () => {
    vi.stubEnv("HEALTH_POOLS_ADDRESS", "");
    vi.stubEnv("NEXT_PUBLIC_HEALTH_POOLS_ADDRESS", "");
    client = fakeClient([]);
    const mod = await load();
    expect(await mod.checkChallengesHealth()).toEqual({
      ok: false,
      code: "no-pools-address",
    });
    expect(client.calls).toHaveLength(0);
  });
});

describe("reads are scoped to this deployment's contract", () => {
  it("getChallengeByToken filters by contract and token", async () => {
    client = fakeClient([
      {
        data: {
          invite_token: TOKEN,
          pool_id: 7,
          challenger_address: CHALLENGER,
          target_handle: null,
          message: null,
          created_at: "2026-09-26T00:00:00Z",
        },
        error: null,
      },
    ]);
    const mod = await load();
    const challenge = await mod.getChallengeByToken(TOKEN);
    expect(challenge?.poolId).toBe("7");
    expect(eqs(client.calls)).toEqual([
      ["contract_address", V4_LOWER],
      ["invite_token", TOKEN],
    ]);
  });

  it("getChallengeByToken returns null without a contract scope", async () => {
    vi.stubEnv("HEALTH_POOLS_ADDRESS", "");
    vi.stubEnv("NEXT_PUBLIC_HEALTH_POOLS_ADDRESS", "");
    client = fakeClient([]);
    const mod = await load();
    expect(await mod.getChallengeByToken(TOKEN)).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("getInviteTokenByPoolId filters by contract and pool id", async () => {
    client = fakeClient([{ data: { invite_token: TOKEN }, error: null }]);
    const mod = await load();
    expect(await mod.getInviteTokenByPoolId(3n)).toBe(TOKEN);
    expect(eqs(client.calls)).toEqual([
      ["contract_address", V4_LOWER],
      ["pool_id", "3"],
    ]);
  });

  it("getChallengesForTargetHandle filters by contract", async () => {
    client = fakeClient([{ data: [], error: null }]);
    const mod = await load();
    await mod.getChallengesForTargetHandle("@Alice");
    expect(eqs(client.calls)).toEqual([["contract_address", V4_LOWER]]);
    const inCall = client.calls.find((c) => c.op === "in");
    expect(inCall?.args).toEqual(["target_handle", ["alice", "@alice"]]);
  });
});

describe("createChallenge", () => {
  const params = {
    rawChallengerAddress: CHALLENGER,
    poolId: 5n,
    rawTargetHandle: null,
    rawMessage: "go",
  };

  it("writes the contract address on the row", async () => {
    client = fakeClient([
      {
        data: {
          invite_token: TOKEN,
          pool_id: "5",
          challenger_address: CHALLENGER,
          target_handle: null,
          message: "go",
          created_at: "2026-09-26T00:00:00Z",
        },
        error: null,
      },
    ]);
    const mod = await load();
    const result = await mod.createChallenge(params);
    expect(result.ok).toBe(true);
    const insert = client.calls.find((c) => c.op === "insert");
    expect(insert?.args[0]).toMatchObject({
      contract_address: V4_LOWER,
      pool_id: "5",
      challenger_address: CHALLENGER,
    });
  });

  it("maps the (contract, pool) unique violation to a 409", async () => {
    client = fakeClient([
      {
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "challenges_contract_address_pool_id_key"',
          details: "Key (contract_address, pool_id)=(0xabc, 5) already exists.",
        },
      },
    ]);
    const mod = await load();
    const result = await mod.createChallenge(params);
    expect(result).toEqual({
      ok: false,
      status: 409,
      reason: "A challenge already exists for this pool.",
    });
  });

  it("retries a token collision with a fresh token", async () => {
    client = fakeClient([
      {
        data: null,
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "challenges_pkey"',
          details: "Key (invite_token)=(x) already exists.",
        },
      },
      {
        data: {
          invite_token: TOKEN,
          pool_id: "5",
          challenger_address: CHALLENGER,
          target_handle: null,
          message: "go",
          created_at: "2026-09-26T00:00:00Z",
        },
        error: null,
      },
    ]);
    const mod = await load();
    const result = await mod.createChallenge(params);
    expect(result.ok).toBe(true);
    expect(client.calls.filter((c) => c.op === "insert")).toHaveLength(2);
  });

  it("returns a 503 with player copy, no env names, when unconfigured", async () => {
    writeConfigured = false;
    client = fakeClient([]);
    const mod = await load();
    const result = await mod.createChallenge(params);
    expect(result).toEqual({
      ok: false,
      status: 503,
      reason: mod.CHALLENGES_UNAVAILABLE_MESSAGE,
    });
    if (!result.ok) expect(result.reason).not.toMatch(/[A-Z_]{6,}/);
  });
});
