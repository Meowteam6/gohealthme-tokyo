// The one explained signature a wallet login gives per session.
//
// What matters: an email or passkey login (Dynamic already signed it in) is
// never prompted; an external wallet is prompted at most once, through
// Dynamic's own sign-in so the result is a session token and not an
// eight-minute signature; a decline is a state, never a loop; and the copy
// says what the signature is before the wallet opens.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { UnsecuredJWT } from "jose";
import {
  PROOF_DECLINED_LINE,
  PROMPT_QUIET_MS,
  PROOF_TIMEOUT_MS,
  SESSION_PROOF_LINE,
  WALLET_GATED_QUERY_ROOTS,
  WALLET_PROOF_LINE,
  answerPrompt,
  canProveSession,
  confirmRegisteredPrompt,
  notifyAuthFlowClosed,
  onAuthFlowClosed,
  pendingPrompt,
  proofLineFor,
  proofSheetVisible,
  proveRegisteredSession,
  proveWalletSession,
  proveWithConfirmation,
  registerPromptGate,
  registerSessionProver,
  resetSessionProofs,
  runSessionProof,
  runVerifyWallet,
  subscribePrompt,
  userListsWallet,
  verifyOutcomeLine,
  type SessionProofDeps,
} from "@/lib/session-proof";
import {
  clearWalletAuth,
  forgetSessionProofDecline,
  rememberSessionProofDecline,
  sessionProofWasDeclined,
} from "@/lib/client-auth";

const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OTHER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const NOW = Date.parse("2026-09-30T12:00:00.000Z");

function token(wallets: string[] = [ADDRESS.toLowerCase()]): string {
  return new UnsecuredJWT({
    scope: "user:basic",
    verified_credentials: wallets.map((address) => ({ format: "blockchain", address })),
  })
    .setExpirationTime(Math.floor((NOW + 2 * 60 * 60 * 1000) / 1000))
    .encode();
}

/** An external wallet, connected, with no Dynamic session yet. */
function external(overrides: Partial<SessionProofDeps> = {}): SessionProofDeps {
  let stored: string | undefined;
  return {
    wantedAddress: ADDRESS,
    activeAddress: ADDRESS,
    proofWalletAddress: ADDRESS,
    isEmbedded: false,
    signedIn: false,
    readToken: () => stored,
    authenticate: vi.fn(async () => {
      stored = token();
    }),
    onCancel: () => () => {},
    now: () => NOW,
    sleep: async () => {},
    ...overrides,
  };
}

beforeEach(() => {
  resetSessionProofs();
  clearWalletAuth();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runSessionProof", () => {
  it("proves an external wallet with one Dynamic sign-in and reads the token it leaves", async () => {
    const deps = external();
    expect(await runSessionProof(deps)).toBe("proven");
    expect(deps.authenticate).toHaveBeenCalledTimes(1);
  });

  it("never prompts when the session token already lists the wallet (email, passkey, a proven wallet)", async () => {
    const authenticate = vi.fn();
    const result = await runSessionProof(
      external({ isEmbedded: true, signedIn: true, readToken: () => token(), authenticate }),
    );
    expect(result).toBe("proven");
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("never prompts an embedded wallet, even without a token", async () => {
    const authenticate = vi.fn();
    expect(
      await runSessionProof(external({ isEmbedded: true, readToken: () => undefined, authenticate })),
    ).toBe("unavailable");
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("never prompts while the wallet kind is still unknown", async () => {
    const authenticate = vi.fn();
    expect(await runSessionProof(external({ isEmbedded: null, authenticate }))).toBe("unavailable");
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("reports unavailable when Dynamic is already signed in with another credential", async () => {
    // authenticateUser refuses a signed-in user; the caller falls back to the
    // plain signature instead of throwing up an error.
    const authenticate = vi.fn();
    expect(await runSessionProof(external({ signedIn: true, authenticate }))).toBe("unavailable");
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("reports unavailable when the wallet asked about is not the one Dynamic would sign with", async () => {
    // Proving the wrong wallet would cost a prompt and still leave this one
    // unproven, which is a second prompt in the same tap.
    const authenticate = vi.fn();
    expect(await runSessionProof(external({ proofWalletAddress: OTHER, authenticate }))).toBe(
      "unavailable",
    );
    expect(await runSessionProof(external({ wantedAddress: OTHER, authenticate }))).toBe(
      "unavailable",
    );
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("matches addresses in any casing", async () => {
    const deps = external({ wantedAddress: ADDRESS.toLowerCase() });
    expect(await runSessionProof(deps)).toBe("proven");
  });

  it("reports unavailable with no wallet", async () => {
    expect(await runSessionProof(external({ wantedAddress: null }))).toBe("unavailable");
  });

  it("reads a sign-in that finished with no token as declined (Dynamic swallows the refusal)", async () => {
    // useSignConnectOnlyUser catches a refused signature, closes its modal and
    // resolves. The promise alone cannot tell success from a no; the token can.
    const deps = external({ authenticate: vi.fn(async () => {}) });
    expect(await runSessionProof(deps)).toBe("declined");
  });

  it("reports unavailable when the sign-in throws before any prompt", async () => {
    const deps = external({
      authenticate: vi.fn(async () => {
        throw new Error("User is already authenticated");
      }),
    });
    expect(await runSessionProof(deps)).toBe("unavailable");
  });

  it("settles as declined when the player closes Dynamic's modal while the wallet still waits", async () => {
    let cancel: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const deps = external({
      authenticate: () => new Promise<void>(() => {}),
      onCancel: (listener) => {
        cancel = listener;
        return unsubscribe;
      },
    });
    const pending = runSessionProof(deps);
    await Promise.resolve();
    cancel?.();
    expect(await pending).toBe("declined");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("still counts a sign-in that lands after the modal closed", async () => {
    let cancel: (() => void) | undefined;
    let stored: string | undefined;
    const deps = external({
      readToken: () => stored,
      authenticate: () => new Promise<void>(() => {}),
      onCancel: (listener) => {
        cancel = listener;
        return () => {};
      },
      // The grace wait is where the late token arrives.
      sleep: async () => {
        stored = token();
      },
    });
    const pending = runSessionProof(deps);
    await Promise.resolve();
    cancel?.();
    expect(await pending).toBe("proven");
  });

  it("opens one Dynamic sign-in for surfaces asking at the same moment", async () => {
    let finish: (() => void) | undefined;
    let stored: string | undefined;
    const authenticate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            stored = token();
            resolve();
          };
        }),
    );
    const deps = external({ readToken: () => stored, authenticate });
    const both = Promise.all([runSessionProof(deps), runSessionProof(deps)]);
    await Promise.resolve();
    finish?.();
    expect(await both).toEqual(["proven", "proven"]);
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it("lets a later tap try again once the first attempt settled", async () => {
    const authenticate = vi.fn(async () => {});
    const deps = external({ authenticate });
    await runSessionProof(deps);
    await runSessionProof(deps);
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it("never answers for a different wallet while a proof is open", async () => {
    // One Dynamic session: a second wallet asking mid-proof must not be told
    // the first wallet's result, and must not open a second sign-in.
    const authenticate = vi.fn(() => new Promise<void>(() => {}));
    void runSessionProof(external({ authenticate }));
    const other = await runSessionProof(
      external({
        wantedAddress: OTHER,
        activeAddress: OTHER,
        proofWalletAddress: OTHER,
        authenticate,
      }),
    );
    expect(other).toBe("unavailable");
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it("does not wait for the grace period when the modal closes on a success", async () => {
    // Dynamic closes its modal (authFlowClose) right after storing the token
    // and before its own promise resolves. That close is not a cancel.
    let cancel: (() => void) | undefined;
    let stored: string | undefined = undefined;
    const sleep = vi.fn(async () => {});
    const deps = external({
      readToken: () => stored,
      authenticate: () => new Promise<void>(() => {}),
      onCancel: (listener) => {
        cancel = listener;
        return () => {};
      },
      sleep,
    });
    const pending = runSessionProof(deps);
    await Promise.resolve();
    stored = token();
    cancel?.();
    expect(await pending).toBe("proven");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up as declined when nothing ever answers, so no caller waits forever", async () => {
    vi.useFakeTimers();
    const pending = runSessionProof(
      external({ authenticate: () => new Promise<void>(() => {}), sleep: async () => {} }),
    );
    await vi.advanceTimersByTimeAsync(PROOF_TIMEOUT_MS);
    expect(await pending).toBe("declined");
  });

  it("settles on Dynamic's real close signal", async () => {
    const pending = runSessionProof(
      external({ authenticate: () => new Promise<void>(() => {}), onCancel: onAuthFlowClosed }),
    );
    await Promise.resolve();
    notifyAuthFlowClosed();
    expect(await pending).toBe("declined");
  });
});

describe("canProveSession", () => {
  const base = {
    address: ADDRESS,
    isEmbedded: false as boolean | null,
    signedIn: false,
    proofWalletAddress: ADDRESS as string | null,
  };

  it("is true only for a connected external wallet Dynamic has not signed in", () => {
    expect(canProveSession(base)).toBe(true);
    expect(canProveSession({ ...base, proofWalletAddress: ADDRESS.toLowerCase() })).toBe(true);
  });

  it("is false for an email or passkey wallet, a signed-in session, an unknown wallet kind, or no wallet", () => {
    expect(canProveSession({ ...base, isEmbedded: true })).toBe(false);
    expect(canProveSession({ ...base, isEmbedded: null })).toBe(false);
    expect(canProveSession({ ...base, signedIn: true })).toBe(false);
    expect(canProveSession({ ...base, address: null })).toBe(false);
  });

  it("is false when Dynamic would sign with a different wallet", () => {
    expect(canProveSession({ ...base, proofWalletAddress: OTHER })).toBe(false);
    expect(canProveSession({ ...base, proofWalletAddress: null })).toBe(false);
  });
});

describe("the registered prover", () => {
  it("is unavailable until the app mounts one, so nothing prompts without Dynamic", async () => {
    expect(await proveRegisteredSession(ADDRESS)).toBe("unavailable");
  });

  it("hands the wallet to the mounted prover and returns its answer", async () => {
    const prover = vi.fn(async () => "proven" as const);
    registerSessionProver(prover);
    expect(await proveRegisteredSession(ADDRESS, { confirmed: true })).toBe("proven");
    // The confirmation travels with the wallet, so a Verify tap is not asked twice.
    expect(prover).toHaveBeenCalledWith(ADDRESS, { confirmed: true });
  });

  it("turns a throwing prover into unavailable", async () => {
    registerSessionProver(async () => {
      throw new Error("not ready");
    });
    expect(await proveRegisteredSession(ADDRESS)).toBe("unavailable");
  });

  it("an old mount unregistering does not remove the newer prover", async () => {
    const unregisterOld = registerSessionProver(async () => "declined" as const);
    registerSessionProver(async () => "proven" as const);
    unregisterOld();
    expect(await proveRegisteredSession(ADDRESS)).toBe("proven");
  });
});

describe("the auth-flow close signal", () => {
  it("reaches every listener until it unsubscribes", () => {
    const listener = vi.fn();
    const unsubscribe = onAuthFlowClosed(listener);
    notifyAuthFlowClosed();
    unsubscribe();
    notifyAuthFlowClosed();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("proveWalletSession", () => {
  // The explained sheet's one action: the session proof and nothing else, so
  // its "once per session" line is never followed by an eight-minute signature.
  it("remembers a decline so ordinary taps sign instead of reopening the proof", async () => {
    expect(await proveWalletSession(ADDRESS, async () => "declined")).toBe("declined");
    expect(sessionProofWasDeclined(ADDRESS)).toBe(true);
  });

  it("clears an earlier decline once proven", async () => {
    rememberSessionProofDecline(ADDRESS);
    expect(await proveWalletSession(ADDRESS, async () => "proven")).toBe("proven");
    expect(sessionProofWasDeclined(ADDRESS)).toBe(false);
  });

  it("never throws, and needs a wallet", async () => {
    expect(
      await proveWalletSession(ADDRESS, async () => {
        throw new Error("boom");
      }),
    ).toBe("unavailable");
    const prove = vi.fn();
    expect(await proveWalletSession(null, prove)).toBe("unavailable");
    expect(prove).not.toHaveBeenCalled();
  });

  it("is the sheet's own Verify tap, so the proof is confirmed and asks nothing more", async () => {
    const prove = vi.fn(async () => "proven" as const);
    await proveWalletSession(ADDRESS, prove);
    expect(prove).toHaveBeenCalledWith(ADDRESS, { confirmed: true });
  });
});

// ------------------------------------------------ asking before the wallet

describe("proveWithConfirmation", () => {
  // Every session proof nobody confirmed (a page load, a Join tap, the verdict
  // card) explains itself first; the wallet opens only after a yes.

  function reader(deps: SessionProofDeps) {
    return vi.fn(() => deps);
  }

  it("asks first, then proves on a yes", async () => {
    const deps = external();
    const confirm = vi.fn(async () => true);
    expect(await proveWithConfirmation({ confirmed: false, readDeps: reader(deps), confirm })).toBe(
      "proven",
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deps.authenticate).toHaveBeenCalledTimes(1);
  });

  it("a Not now opens no wallet and reads as dismissed, not declined", async () => {
    const deps = external();
    const confirm = vi.fn(async () => false);
    expect(await proveWithConfirmation({ confirmed: false, readDeps: reader(deps), confirm })).toBe(
      "dismissed",
    );
    expect(deps.authenticate).not.toHaveBeenCalled();
  });

  it("a throwing question is a no", async () => {
    const deps = external();
    const result = await proveWithConfirmation({
      confirmed: false,
      readDeps: reader(deps),
      confirm: async () => {
        throw new Error("gone");
      },
    });
    expect(result).toBe("dismissed");
    expect(deps.authenticate).not.toHaveBeenCalled();
  });

  it("a confirmed request (a Verify tap) is not asked again", async () => {
    const deps = external();
    const confirm = vi.fn(async () => false);
    expect(await proveWithConfirmation({ confirmed: true, readDeps: reader(deps), confirm })).toBe(
      "proven",
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it("never asks when nothing would open: already proven, or a proof that cannot run", async () => {
    const confirm = vi.fn(async () => true);
    expect(
      await proveWithConfirmation({
        confirmed: false,
        readDeps: reader(external({ readToken: () => token() })),
        confirm,
      }),
    ).toBe("proven");
    expect(
      await proveWithConfirmation({
        confirmed: false,
        readDeps: reader(external({ isEmbedded: true })),
        confirm,
      }),
    ).toBe("unavailable");
    expect(await proveWithConfirmation({ confirmed: false, readDeps: () => null, confirm })).toBe(
      "unavailable",
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it("proves with Dynamic's state as it is after the answer, not as it was before", async () => {
    // The player may take a while to answer; the sign-in hook from before
    // could be stale by then.
    const stale = external();
    const fresh = external();
    let current = stale;
    const confirm = vi.fn(async () => {
      current = fresh;
      return true;
    });
    await proveWithConfirmation({ confirmed: false, readDeps: () => current, confirm });
    expect(stale.authenticate).not.toHaveBeenCalled();
    expect(fresh.authenticate).toHaveBeenCalledTimes(1);
  });

  it("a proof that landed while the question was open is used, with no prompt", async () => {
    let stored: string | undefined;
    const deps = external({ readToken: () => stored });
    const confirm = vi.fn(async () => {
      stored = token();
      return true;
    });
    expect(await proveWithConfirmation({ confirmed: false, readDeps: () => deps, confirm })).toBe(
      "proven",
    );
    expect(deps.authenticate).not.toHaveBeenCalled();
  });
});

describe("the prompt question", () => {
  // The in-page question the sheet renders. Framework-free so its rules are
  // tested here: one question at a time, shared by every surface that asks.

  it("answers yes at once when no sheet is mounted (no Dynamic, tests, e2e)", async () => {
    expect(await confirmRegisteredPrompt(ADDRESS, "signature")).toBe(true);
    expect(pendingPrompt()).toBeNull();
  });

  it("holds the question until the player answers", async () => {
    registerPromptGate();
    const answer = confirmRegisteredPrompt(ADDRESS, "session");
    expect(pendingPrompt()).toEqual({ address: ADDRESS, kind: "session" });
    answerPrompt(true);
    expect(await answer).toBe(true);
    expect(pendingPrompt()).toBeNull();
  });

  it("shares one question between surfaces asking together", async () => {
    registerPromptGate();
    const first = confirmRegisteredPrompt(ADDRESS, "session");
    const second = confirmRegisteredPrompt(ADDRESS.toLowerCase(), "signature");
    // The first question stands; a second one is not stacked on it.
    expect(pendingPrompt()).toEqual({ address: ADDRESS, kind: "session" });
    answerPrompt(false);
    expect(await Promise.all([first, second])).toEqual([false, false]);
  });

  it("a question for another wallet replaces a stale one with a no", async () => {
    registerPromptGate();
    const stale = confirmRegisteredPrompt(OTHER, "session");
    const current = confirmRegisteredPrompt(ADDRESS, "session");
    expect(await stale).toBe(false);
    expect(pendingPrompt()).toEqual({ address: ADDRESS, kind: "session" });
    answerPrompt(true);
    expect(await current).toBe(true);
  });

  it("tells the sheet whenever the question changes", async () => {
    registerPromptGate();
    const listener = vi.fn();
    const unsubscribe = subscribePrompt(listener);
    const answer = confirmRegisteredPrompt(ADDRESS, "session");
    answerPrompt(true);
    await answer;
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("after a Not now, a surface that keeps asking (a claim loop polling every 800ms) is told no without the sheet coming back", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    registerPromptGate();
    const first = confirmRegisteredPrompt(ADDRESS, "session");
    answerPrompt(false);
    expect(await first).toBe(false);
    for (let poll = 0; poll < 5; poll++) {
      vi.setSystemTime(NOW + (poll + 1) * 1_000);
      expect(await confirmRegisteredPrompt(ADDRESS, "session")).toBe(false);
      expect(pendingPrompt()).toBeNull();
    }
  });

  it("once the asking stops, the next tap is asked again: a no is never forever", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    registerPromptGate();
    const first = confirmRegisteredPrompt(ADDRESS, "session");
    answerPrompt(false);
    await first;
    vi.setSystemTime(NOW + PROMPT_QUIET_MS + 1);
    const again = confirmRegisteredPrompt(ADDRESS, "session");
    expect(pendingPrompt()).toEqual({ address: ADDRESS, kind: "session" });
    answerPrompt(true);
    expect(await again).toBe(true);
  });

  it("a yes leaves no quiet period, and a Not now for one wallet never silences another", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    registerPromptGate();
    const yes = confirmRegisteredPrompt(ADDRESS, "session");
    answerPrompt(true);
    await yes;
    void confirmRegisteredPrompt(ADDRESS, "signature");
    expect(pendingPrompt()).toEqual({ address: ADDRESS, kind: "signature" });
    answerPrompt(false);
    void confirmRegisteredPrompt(OTHER, "session");
    expect(pendingPrompt()).toEqual({ address: OTHER, kind: "session" });
    answerPrompt(false);
  });

  it("unmounting the sheet answers an open question with a no, so no caller hangs", async () => {
    const unregister = registerPromptGate();
    const answer = confirmRegisteredPrompt(ADDRESS, "session");
    unregister();
    expect(await answer).toBe(false);
    expect(await confirmRegisteredPrompt(ADDRESS, "session")).toBe(true);
  });
});

describe("runVerifyWallet", () => {
  // The quiet "Verify wallet" action on locked data.
  it("offers the session proof again after a decline, and asks for a fresh credential", async () => {
    rememberSessionProofDecline(ADDRESS);
    const requestAuth = vi.fn(async () => {
      // By the time the requester runs, the decline memory is gone.
      expect(sessionProofWasDeclined(ADDRESS)).toBe(false);
      return { kind: "ok", credential: null, headers: {} } as const;
    });
    const invalidate = vi.fn(async () => {});
    const line = await runVerifyWallet({ address: ADDRESS, requestAuth, invalidate });
    expect(line).toBeNull();
    // The Verify tap IS the confirmation: the explanation sits right above
    // the button, so the wallet opens without a second question.
    expect(requestAuth).toHaveBeenCalledWith({ refresh: true, confirmed: true });
  });

  it("re-reads every wallet-gated query once verified", async () => {
    const invalidate = vi.fn<(root: string) => Promise<void>>(async () => {});
    await runVerifyWallet({
      address: ADDRESS,
      requestAuth: async () => ({ kind: "ok", credential: null, headers: {} }),
      invalidate,
    });
    expect(invalidate.mock.calls.map(([root]) => root).sort()).toEqual(
      [...WALLET_GATED_QUERY_ROOTS].sort(),
    );
  });

  it("says what happened on a decline and re-reads nothing", async () => {
    const invalidate = vi.fn(async () => {});
    const line = await runVerifyWallet({
      address: ADDRESS,
      requestAuth: async () => ({ kind: "declined" }),
      invalidate,
    });
    expect(line).toBe(PROOF_DECLINED_LINE);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("never throws into a click handler", async () => {
    const line = await runVerifyWallet({
      address: ADDRESS,
      requestAuth: async () => {
        throw new Error("boom");
      },
      invalidate: async () => {},
    });
    expect(line).toMatch(/nothing changed/i);
    forgetSessionProofDecline(ADDRESS);
  });
});

describe("proofSheetVisible", () => {
  const base = {
    intended: true,
    canProve: true,
    sessionProven: false,
    dismissed: false,
    done: false,
  };

  it("shows right after an explicit external-wallet connect", () => {
    expect(proofSheetVisible(base)).toBe(true);
  });

  it("never shows on a silent reconnect nobody asked for (a reload)", () => {
    expect(proofSheetVisible({ ...base, intended: false })).toBe(false);
  });

  it("never shows when a session proof is not possible (email, passkey, signed in)", () => {
    expect(proofSheetVisible({ ...base, canProve: false })).toBe(false);
  });

  it("goes away once proven, dismissed, or verified another way", () => {
    expect(proofSheetVisible({ ...base, sessionProven: true })).toBe(false);
    expect(proofSheetVisible({ ...base, dismissed: true })).toBe(false);
    expect(proofSheetVisible({ ...base, done: true })).toBe(false);
  });

  it("never sits behind Dynamic's own modal", () => {
    expect(proofSheetVisible({ ...base, authFlowOpen: true })).toBe(false);
    expect(proofSheetVisible({ ...base, authFlowOpen: false })).toBe(true);
  });
});

describe("the explanation", () => {
  it("says what the signature is, what it costs and how often, before the wallet opens", () => {
    expect(SESSION_PROOF_LINE).toBe(
      "One free signature proves this wallet is yours. No transaction, no cost, once per session.",
    );
  });

  it("does not promise once per session where only the short-lived signature can run", () => {
    expect(proofLineFor(true)).toBe(SESSION_PROOF_LINE);
    expect(proofLineFor(false)).toBe(WALLET_PROOF_LINE);
    expect(WALLET_PROOF_LINE).not.toMatch(/once per session/);
  });

  it("keeps every line in the house voice: no dashes, no exclamation marks, no betting words", () => {
    const lines = [
      SESSION_PROOF_LINE,
      WALLET_PROOF_LINE,
      PROOF_DECLINED_LINE,
      verifyOutcomeLine({ kind: "failed", message: "wrong chain" }) ?? "",
      verifyOutcomeLine({ kind: "unsigned" }) ?? "",
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/[—–!]|\s-\s/);
      expect(line).not.toMatch(/\b(bet|wager|odds|pool|run|dare|winner)\b/i);
    }
  });
});

describe("verifyOutcomeLine", () => {
  it("says nothing when the wallet is verified", () => {
    expect(verifyOutcomeLine({ kind: "ok", credential: null, headers: {} })).toBeNull();
  });

  it("treats a no as a choice with a way back, not an error", () => {
    expect(verifyOutcomeLine({ kind: "declined" })).toBe(PROOF_DECLINED_LINE);
  });

  it("names a failure without blaming the player", () => {
    expect(verifyOutcomeLine({ kind: "failed", message: "wrong chain" })).toMatch(/nothing changed/i);
  });
});

describe("userListsWallet", () => {
  // The render-time answer to "is this wallet proven": Dynamic's user object,
  // which re-renders when the sign-in lands (the token itself is not reactive).
  it("is true when Dynamic's signed-in user lists the wallet, in any casing", () => {
    const user = {
      verifiedCredentials: [
        { format: "email", email: "a@b.co" },
        { format: "blockchain", address: ADDRESS.toLowerCase() },
      ],
    };
    expect(userListsWallet(user, ADDRESS)).toBe(true);
  });

  it("is false for a connect-only session, another wallet, or a malformed user", () => {
    expect(userListsWallet(undefined, ADDRESS)).toBe(false);
    expect(userListsWallet(null, ADDRESS)).toBe(false);
    expect(
      userListsWallet({ verifiedCredentials: [{ format: "blockchain", address: OTHER }] }, ADDRESS),
    ).toBe(false);
    expect(userListsWallet({ verifiedCredentials: "nope" }, ADDRESS)).toBe(false);
    expect(userListsWallet({ verifiedCredentials: [{ format: "blockchain" }] }, ADDRESS)).toBe(false);
  });

  it("is false with no wallet", () => {
    expect(
      userListsWallet({ verifiedCredentials: [{ format: "blockchain", address: ADDRESS }] }, null),
    ).toBe(false);
  });
});

describe("WALLET_GATED_QUERY_ROOTS", () => {
  it("covers every read that answers differently once the wallet is proven", () => {
    // invited-challenges: /challenges reads the invites aimed at your handle
    // with the wallet credential, and shows none until it has one.
    expect([...WALLET_GATED_QUERY_ROOTS].sort()).toEqual(
      [
        "claim-ledger",
        "invited-challenges",
        "wearable-data",
        "wearable-progress",
        "wearable-providers",
      ].sort(),
    );
  });
});
