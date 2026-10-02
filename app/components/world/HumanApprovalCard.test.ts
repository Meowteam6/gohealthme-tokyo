// The World ID confirm card never opens a wallet on its own. Its mount read
// (loadApproval) is quiet by construction: whatever requester it is handed, it
// reads cached credentials only, the 401 retry included. A wallet that has not
// proven itself this session lands on the explained Verify wallet step, and
// the tap (or a proof landing elsewhere) is what opens the ask.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnsecuredJWT } from "jose";
import { clearWalletAuth, walletAuthRequester } from "@/lib/client-auth";
import {
  loadApproval,
  openApprovalRequest,
  proofLandedWhileWaiting,
} from "@/components/world/HumanApprovalCard";

const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const GOAL = `0x${"ab".repeat(32)}`;

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

const PENDING = {
  requestId: "req-1",
  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  status: "pending",
  attempt: 1,
  action: "approve-payout",
  signal: `${GOAL}:1`,
  provider: "mock",
  mocked: true,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Status says nothing is answered yet; the request route answers `request`. */
function server(request: () => Response) {
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("/api/agent/approval/status")) return json({ status: "none" });
    return request();
  });
}

const requestCalls = (fetchImpl: ReturnType<typeof server>) =>
  fetchImpl.mock.calls.filter(([url]) => String(url) === "/api/agent/approval/request");

beforeEach(() => {
  clearWalletAuth();
});

describe("loadApproval (the mount read)", () => {
  it("never prompts a wallet with no proof, and shows the Verify wallet step instead", async () => {
    const { requestAuth, prompts } = wallet();
    const fetchImpl = server(() => json(PENDING));

    const state = await loadApproval(GOAL, requestAuth, fetchImpl);

    expect(state).toEqual({ kind: "verify", note: null });
    expect(prompts()).toBe(0);
    // No unsigned POST either: the request route would only answer 401.
    expect(requestCalls(fetchImpl)).toHaveLength(0);
  });

  it("proceeds as before when a session token already proves the wallet", async () => {
    const token = sessionToken();
    const { requestAuth, prompts } = wallet(() => token);
    const fetchImpl = server(() => json(PENDING));

    const state = await loadApproval(GOAL, requestAuth, fetchImpl);

    expect(state.kind).toBe("pending");
    expect(prompts()).toBe(0);
    const [, init] = requestCalls(fetchImpl)[0];
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
  });

  it("keeps the 401 retry quiet: a refused token lands on Verify wallet, not a popup", async () => {
    const token = sessionToken();
    const { requestAuth, prompts } = wallet(() => token);
    const fetchImpl = server(() => json({ error: "refused" }, 401));

    const state = await loadApproval(GOAL, requestAuth, fetchImpl);

    expect(state).toEqual({ kind: "verify", note: null });
    expect(prompts()).toBe(0);
  });

  it("adopts a finished answer without asking the wallet anything", async () => {
    const { requestAuth, prompts } = wallet();
    const fetchImpl = vi.fn(async () => json({ status: "declined", requestId: "req-1" }));

    const state = await loadApproval(GOAL, requestAuth, fetchImpl);

    expect(state).toEqual({ kind: "done", outcome: "declined", requestId: "req-1" });
    expect(prompts()).toBe(0);
  });
});

describe("openApprovalRequest (a tap)", () => {
  it("a declined prompt is the Verify wallet step with the plain no, never a loop", async () => {
    const signMessage = vi.fn(async () => {
      throw Object.assign(new Error("User rejected the request."), { code: 4001 });
    });
    const requestAuth = walletAuthRequester({
      address: ADDRESS,
      signMessage,
      getSessionToken: () => undefined,
      proveSession: null,
    });
    const fetchImpl = server(() => json(PENDING));

    const state = await openApprovalRequest(GOAL, requestAuth, fetchImpl);

    expect(state.kind).toBe("verify");
    expect(state.kind === "verify" ? state.note : null).toMatch(/No signature/);
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(requestCalls(fetchImpl)).toHaveLength(0);
  });

  it("a player paid on the verdict is told so, never that payouts wait on a fix", async () => {
    const token = sessionToken();
    const { requestAuth, prompts } = wallet(() => token);
    const fetchImpl = server(() =>
      json(
        {
          error: "SPOTTER pays you on the verdict, so there is nothing to confirm with World ID.",
          code: "on-verdict",
        },
        409,
      ),
    );

    const state = await openApprovalRequest(GOAL, requestAuth, fetchImpl);

    expect(state).toMatchObject({ kind: "blocked", retry: false, onVerdict: true });
    expect(prompts()).toBe(0);
  });

  it("a wallet with nothing connected stays a blocked card, not a Verify step", async () => {
    const requestAuth = walletAuthRequester({
      address: null,
      signMessage: null,
      getSessionToken: null,
      proveSession: null,
    });
    const state = await openApprovalRequest(GOAL, requestAuth, server(() => json(PENDING)));
    expect(state.kind).toBe("blocked");
  });
});

describe("proofLandedWhileWaiting", () => {
  it("fires once when the session proof lands while the card waits on it", () => {
    let seen: boolean | null = null;
    let step = proofLandedWhileWaiting(seen, true, false);
    expect(step.proceed).toBe(false);
    seen = step.seen;
    step = proofLandedWhileWaiting(seen, true, true);
    expect(step.proceed).toBe(true);
  });

  it("never fires for a wallet that was already proven when the wait began", () => {
    // Proven yet still waiting means the server refused the proof: re-asking
    // on every render would be a loop.
    const step = proofLandedWhileWaiting(null, true, true);
    expect(step.proceed).toBe(false);
    expect(proofLandedWhileWaiting(step.seen, true, true).proceed).toBe(false);
  });

  it("forgets the wait once the card moves on", () => {
    expect(proofLandedWhileWaiting(false, false, true)).toEqual({ seen: null, proceed: false });
  });
});
