// Opening a claim page never opens a wallet. The two reads a claim surface
// makes on load (the claim restore, shared by the wearable and document
// paths, and the wearable connection read) are quiet by construction:
// whatever requester they are handed, they read cached credentials only, and
// the 401 retry inside fetchWithWalletAuth stays cached-only too.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnsecuredJWT } from "jose";
import { clearWalletAuth, walletAuthRequester } from "@/lib/client-auth";
import { readClaimOnLoad, readProviderOnLoad } from "@/components/WearableCheck";

const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const GOAL = `0x${"cd".repeat(32)}`;
const POOL = 7n;

function sessionToken(): string {
  return new UnsecuredJWT({
    scope: "user:basic",
    verified_credentials: [
      { format: "blockchain", address: ADDRESS.toLowerCase(), chain: "eip155" },
    ],
  })
    .setExpirationTime(Math.floor((Date.now() + 60 * 60 * 1000) / 1000))
    .encode();
}

/** A real requester bound to spies, so any prompt at all is counted. */
function wallet(token: () => string | undefined = () => undefined) {
  const signMessage = vi.fn(async () => "0xabcdef");
  const proveSession = vi.fn(async () => "declined" as const);
  const confirmPrompt = vi.fn(async () => true);
  const requestAuth = walletAuthRequester({
    address: ADDRESS,
    signMessage,
    getSessionToken: token,
    proveSession,
    confirmPrompt,
  });
  const prompts = () =>
    signMessage.mock.calls.length +
    proveSession.mock.calls.length +
    confirmPrompt.mock.calls.length;
  return { requestAuth, prompts };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const LEDGER = [{ kind: "plan", at: "2026-09-30T00:00:00.000Z" }];

beforeEach(() => {
  clearWalletAuth();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readClaimOnLoad", () => {
  it("shows a claim as private, waiting on a proof, without prompting", async () => {
    const { requestAuth, prompts } = wallet();
    const fetchImpl = vi.fn(async () => json({ hasLedger: true }));

    const read = await readClaimOnLoad(GOAL, POOL, requestAuth, fetchImpl);

    expect(read.visibility.kind).toBe("locked");
    expect(read.lockedByProof).toBe(true);
    expect(prompts()).toBe(0);
    // Still asked, unsigned: the redacted answer is what says a claim exists.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("restores the receipt with no prompt when a session token proves the wallet", async () => {
    const token = sessionToken();
    const { requestAuth, prompts } = wallet(() => token);
    const fetchImpl = vi.fn(async () => json({ hasLedger: true, ledger: LEDGER }));

    const read = await readClaimOnLoad(GOAL, POOL, requestAuth, fetchImpl);

    expect(read.visibility.kind).toBe("visible");
    expect(read.lockedByProof).toBe(false);
    expect(prompts()).toBe(0);
  });

  it("keeps the 401 retry quiet when the server refuses the token", async () => {
    const token = sessionToken();
    const { requestAuth, prompts } = wallet(() => token);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "refused" }, 401))
      .mockResolvedValueOnce(json({ hasLedger: true }));

    const read = await readClaimOnLoad(GOAL, POOL, requestAuth, fetchImpl);

    expect(prompts()).toBe(0);
    expect(read.visibility.kind).toBe("locked");
    expect(read.lockedByProof).toBe(true);
  });

  it("a claim withheld from a proven wallet is not waiting on a proof", async () => {
    const token = sessionToken();
    const { requestAuth } = wallet(() => token);
    const fetchImpl = vi.fn(async () => json({ hasLedger: true, access: "not-owner" }));

    const read = await readClaimOnLoad(GOAL, POOL, requestAuth, fetchImpl);

    expect(read.visibility.kind).toBe("locked");
    expect(read.lockedByProof).toBe(false);
  });

  it("no claim at all is none, not private", async () => {
    const { requestAuth } = wallet();
    const read = await readClaimOnLoad(GOAL, POOL, requestAuth, vi.fn(async () => json({ hasLedger: false })));
    expect(read.visibility.kind).toBe("none");
    expect(read.lockedByProof).toBe(false);
  });
});

describe("a private claim still in flight keeps moving with no tap", () => {
  // The run route never needs a proof to progress (route.ts: "The signature
  // does NOT gate the run itself"), only to show its rows. So a claim that is
  // private only for want of a proof, and still mid-run, is resumed quietly:
  // a wallet that has not proven itself must not stall SPOTTER until a tap.
  const PUBLIC = {
    goalId: GOAL,
    at: "2026-09-30T00:00:00.000Z",
    decision: null,
    spends: [],
    recordTxs: null,
    settle: null,
    selfReported: false,
    approval: null,
  };
  const approval = (status: string) => ({
    at: "2026-09-30T00:01:00.000Z",
    status,
    provider: "world",
    expiresAtIso: null,
    credential: null,
  });
  const settle = (status: string) => ({
    at: "2026-09-30T00:02:00.000Z",
    status,
    paidUsd: null,
    txHash: null,
    periodEndIso: null,
  });
  const RECORDED = { resultTx: "0x1", registryTx: null };

  it.each([
    ["mid-run, no decision yet", {}, true],
    ["decided to pay, not recorded", { decision: "pay" }, true],
    ["waiting on the human (the confirm needs the tap)", { decision: "pay", approval: approval("requested") }, false],
    ["the human said yes, record next", { decision: "pay", approval: approval("approved") }, true],
    ["recorded, settle next", { decision: "pay", recordTxs: RECORDED }, true],
    ["a no-pay", { decision: "no-pay" }, false],
    ["the human said no", { decision: "pay", approval: approval("declined") }, false],
    ["the ask lapsed", { decision: "pay", approval: approval("expired") }, false],
    ["the ask was cancelled", { decision: "pay", approval: approval("cancelled") }, false],
    ["settle deferred to the sweep", { decision: "pay", recordTxs: RECORDED, settle: settle("deferred") }, false],
    ["paid", { decision: "pay", settle: settle("settled") }, false],
    ["a recorded miss", { missed: true, recordTxs: RECORDED }, false],
    ["stopped on an error", { problem: { at: "2026-09-30T00:03:00.000Z", stage: "buy" } }, false],
  ])("%s: resume=%s", async (_label, patch, resume) => {
    const { requestAuth, prompts } = wallet();
    const fetchImpl = vi.fn(async () => json({ hasLedger: true, claim: { ...PUBLIC, ...patch } }));

    const read = await readClaimOnLoad(GOAL, POOL, requestAuth, fetchImpl);

    expect(read.lockedByProof).toBe(true);
    expect(read.resume).toBe(resume);
    expect(prompts()).toBe(0);
  });

  it("never resumes a claim the server says is somebody else's", async () => {
    const token = sessionToken();
    const { requestAuth } = wallet(() => token);
    const fetchImpl = vi.fn(async () =>
      json({ hasLedger: true, access: "not-owner", claim: PUBLIC }),
    );
    const read = await readClaimOnLoad(GOAL, POOL, requestAuth, fetchImpl);
    expect(read.resume).toBe(false);
  });

  it("an unreadable projection is not resumed", async () => {
    const { requestAuth } = wallet();
    const read = await readClaimOnLoad(
      GOAL,
      POOL,
      requestAuth,
      vi.fn(async () => json({ hasLedger: true })),
    );
    expect(read.resume).toBe(false);
  });

  it("the wearable panel resumes a resumable private claim quietly", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("components/WearableCheck.tsx", "utf8");
    expect(source).toMatch(/if \(read\.resume\) void pollRun\(goalId, false\)/);
  });
});

describe("readProviderOnLoad", () => {
  it("never prompts, even on the 401 retry after a refused token", async () => {
    const token = sessionToken();
    const { requestAuth, prompts } = wallet(() => token);
    const fetchImpl = vi.fn(async () => json({ error: "Sign with your wallet." }, 401));
    vi.stubGlobal("fetch", fetchImpl);

    const state = await readProviderOnLoad(ADDRESS, requestAuth, undefined, "steps");

    expect(prompts()).toBe(0);
    expect(state.kind).toBe("auth-required");
  });

  it("an unproven wallet gets the locked answer, not a popup", async () => {
    const { requestAuth, prompts } = wallet();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Sign with your wallet." }, 401)));

    const state = await readProviderOnLoad(ADDRESS, requestAuth);

    expect(prompts()).toBe(0);
    expect(state.kind).toBe("auth-required");
  });
});

describe("both claim surfaces restore through the quiet read", () => {
  // The wiring, not the helper: a surface that went back to its own signed
  // fetch for the restore would prompt on load again.
  it.each(["components/WearableCheck.tsx", "components/EvidenceUpload.tsx"])(
    "%s restores with readClaimOnLoad and resumes loops quietly",
    async (file) => {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(file, "utf8");
      expect(source).toMatch(/await readClaimOnLoad\(goalId, poolId, requestAuth\)/);
      // Only readClaimOnLoad itself may build the restore URL.
      const restoreFetches = source.match(/\?poolId=\$\{poolId\.toString\(\)\}/g) ?? [];
      expect(restoreFetches.length).toBe(file.endsWith("WearableCheck.tsx") ? 1 : 0);
      // Loops nobody tapped for pass prompt=false; the one tap passes true.
      expect(source.match(/pollRun\([^)]*, true\)/g)?.length).toBe(1);
      expect(source).toMatch(/prompt && attempt === 0 \? requestAuth : quietAuth/);
    },
  );
});
