// The one explained signature a wallet login gives per session.
//
// WHY THIS EXISTS. Sign-in stays connect-only (providers.tsx), so an external
// wallet (MetaMask, the Coinbase extension, a Base Account, WalletConnect)
// connects without signing anything and Dynamic issues no session token for
// it. Every private read then needed the ad-hoc "prove control" signature from
// lib/client-auth.ts, which lasts eight minutes and dies on reload: prompts all
// over the app. Dynamic documents the fix: start connect-only, and upgrade the
// session with authenticateUser() when proof is needed. That is ONE signature
// (Dynamic's own sign-in message), and the session token it leaves lists the
// wallet, so lib/server/dynamic-jwt.ts accepts it for the rest of the session.
//
// This module is framework-free so every decision is node-tested. The React
// half is components/SessionProofSheet.tsx, which registers the prover (it
// holds Dynamic's hooks), forwards Dynamic's authFlowClose event, and renders
// the in-page question every prompt waits on (below): whatever surface asked,
// the wallet opens only after the player has read the line and said yes.
//
// WHAT DYNAMIC DOES, read from @dynamic-labs/sdk-react-core 4.88.6:
//   - authenticateUser throws "User is already authenticated" when a user
//     exists and "No connected wallet" with none; nothing was prompted.
//   - it signs with connectedWallets[0], which is userWallets[0] while nobody
//     is signed in. Proving a different wallet than the one asked about would
//     cost a prompt and still leave this one unproven, so that is refused.
//   - a refused signature is swallowed (useSignConnectOnlyUser closes its
//     modal and resolves), so the promise cannot tell yes from no. The token
//     can: it is stored before the promise resolves.
//   - closing Dynamic's modal while the wallet still waits leaves the promise
//     pending. authFlowClose fires on every close, a success included, so a
//     close is read as "look at the token", with a short grace for a signature
//     that lands just after.

import {
  forgetSessionProofDecline,
  rememberSessionProofDecline,
  sessionTokenCoversAddress,
  type ClientAuth,
  type ConfirmPromptFn,
  type PromptKind,
  type ProveSessionFn,
  type SessionProofResult,
  type WalletAuthRequester,
} from "@/lib/client-auth";

export type { PromptKind, SessionProofResult };

// ------------------------------------------------------------------- copy

/** Shown before the wallet opens, where the session proof can run. */
export const SESSION_PROOF_LINE =
  "One free signature proves this wallet is yours. No transaction, no cost, once per session.";

/** Shown where only the short-lived signature can run (Dynamic is signed in
 *  with another credential): no promise about the rest of the session. */
export const WALLET_PROOF_LINE =
  "One free signature proves this wallet is yours. No transaction, no cost.";

/** After a no, or a proof that did not finish. A choice, with a way back. */
export const PROOF_DECLINED_LINE =
  "No signature, so your private data stays locked. Nothing was charged. Verify wallet whenever you are ready.";

const VERIFY_FAILED_LINE =
  "Your wallet could not finish the signature. Nothing changed. Try again in a moment.";

const VERIFY_SILENT_LINE =
  "Your wallet did not answer. Nothing changed. Try again in a moment.";

const VERIFY_NO_WALLET_LINE = "Connect a wallet first. Nothing changed.";

/** The explanation for the wallet in hand. */
export function proofLineFor(sessionProofPossible: boolean): string {
  return sessionProofPossible ? SESSION_PROOF_LINE : WALLET_PROOF_LINE;
}

/** What a Verify tap ended in, or null when the wallet is verified. Never
 *  echoes a wallet's raw error: no plumbing reaches the player. */
export function verifyOutcomeLine(auth: ClientAuth): string | null {
  switch (auth.kind) {
    case "ok":
      return null;
    case "declined":
      return PROOF_DECLINED_LINE;
    case "failed":
      return VERIFY_FAILED_LINE;
    case "unsigned":
      return VERIFY_SILENT_LINE;
    case "no-wallet":
      return VERIFY_NO_WALLET_LINE;
  }
}

// ------------------------------------------------------------ who can prove

function sameAddress(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
}

/**
 * Whether Dynamic's session proof can run for this wallet: an external wallet
 * (email and passkey wallets already hold a token), nobody signed in yet
 * (authenticateUser refuses a signed-in user), and Dynamic would sign with
 * this very wallet.
 */
export function canProveSession(params: {
  address: string | null;
  isEmbedded: boolean | null;
  signedIn: boolean;
  proofWalletAddress: string | null;
}): boolean {
  return (
    params.address !== null &&
    params.isEmbedded === false &&
    !params.signedIn &&
    sameAddress(params.proofWalletAddress, params.address)
  );
}

/**
 * Whether Dynamic's signed-in user lists `address` as a proven wallet. This is
 * the render-time answer to "is this wallet proven": the user object
 * re-renders when a sign-in lands, and the token itself is not reactive.
 */
export function userListsWallet(user: unknown, address: string | null): boolean {
  if (address === null || typeof user !== "object" || user === null) return false;
  const credentials = (user as { verifiedCredentials?: unknown }).verifiedCredentials;
  if (!Array.isArray(credentials)) return false;
  const wanted = address.toLowerCase();
  return credentials.some((credential: unknown) => {
    if (typeof credential !== "object" || credential === null) return false;
    const { format, address: listed } = credential as { format?: unknown; address?: unknown };
    return format === "blockchain" && typeof listed === "string" && listed.toLowerCase() === wanted;
  });
}

// ------------------------------------------------------------- the proof

/** A proof nobody answers ends as declined after this, so no caller (and no
 *  inflight wallet auth shared by every surface) waits forever. */
export const PROOF_TIMEOUT_MS = 3 * 60 * 1000;

/** After Dynamic's modal closes, how long a late signature still counts. */
export const PROOF_CANCEL_GRACE_MS = 1_500;

export interface SessionProofDeps {
  /** The wallet the caller needs proven. */
  wantedAddress: string | null;
  /** The app's active wallet (lib/wallet.ts). */
  activeAddress: string | null;
  /** The wallet Dynamic would sign with (userWallets[0] while signed out). */
  proofWalletAddress: string | null;
  isEmbedded: boolean | null;
  /** Dynamic already has a user (any credential). */
  signedIn: boolean;
  /** Dynamic's getAuthToken. */
  readToken: () => string | null | undefined;
  /** Dynamic's authenticateUser (useAuthenticateConnectedUser). */
  authenticate: () => Promise<void>;
  /** Subscribe to Dynamic's modal closing; returns the unsubscribe. */
  onCancel: (listener: () => void) => () => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function tokenOf(readToken: () => string | null | undefined): string | null {
  try {
    const token = readToken();
    return typeof token === "string" && token.trim() !== "" ? token.trim() : null;
  } catch {
    return null;
  }
}

// One Dynamic session, so one proof at a time. Surfaces asking about the same
// wallet share it; a different wallet asking mid-proof is told "unavailable".
let inflight: { key: string; promise: Promise<SessionProofResult> } | null = null;

/**
 * Prove `wantedAddress` to Dynamic, prompting at most once. Resolves:
 * "proven" when the session token lists the wallet (prompted or not),
 * "declined" when the wallet was asked and no token came of it, and
 * "unavailable" when nothing was asked (so the caller may sign instead).
 * Never rejects.
 */
function coveredBy(deps: SessionProofDeps, wanted: string): () => boolean {
  const now = deps.now ?? Date.now;
  return () => {
    const token = tokenOf(deps.readToken);
    return token !== null && sessionTokenCoversAddress(token, wanted, now());
  };
}

/**
 * What a proof would do right now, without doing it: "proven" (the token
 * already lists the wallet, nothing opens), "unavailable" (the proof cannot
 * run here, nothing opens) or "ask" (the wallet would open).
 */
export function sessionProofPrecheck(deps: SessionProofDeps): "proven" | "unavailable" | "ask" {
  const wanted = deps.wantedAddress;
  if (wanted === null) return "unavailable";
  // Email, passkey, or a wallet proven earlier this session: no prompt.
  if (coveredBy(deps, wanted)()) return "proven";
  if (
    !canProveSession({
      address: wanted,
      isEmbedded: deps.isEmbedded,
      signedIn: deps.signedIn,
      proofWalletAddress: deps.proofWalletAddress,
    }) ||
    !sameAddress(deps.activeAddress, wanted)
  ) {
    return "unavailable";
  }
  return "ask";
}

export function runSessionProof(deps: SessionProofDeps): Promise<SessionProofResult> {
  const wanted = deps.wantedAddress;
  if (wanted === null) return Promise.resolve("unavailable");
  const pre = sessionProofPrecheck(deps);
  if (pre !== "ask") return Promise.resolve(pre);
  const covered = coveredBy(deps, wanted);

  const key = wanted.toLowerCase();
  if (inflight !== null) {
    return inflight.key === key ? inflight.promise : Promise.resolve("unavailable");
  }
  const entry = { key, promise: attemptProof(deps, covered) };
  inflight = entry;
  void entry.promise.finally(() => {
    if (inflight === entry) inflight = null;
  });
  return entry.promise;
}

async function attemptProof(
  deps: SessionProofDeps,
  covered: () => boolean,
): Promise<SessionProofResult> {
  const sleep = deps.sleep ?? defaultSleep;
  let unsubscribe: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Subscribed before anything awaits, so a close can never slip past.
  const cancelled = new Promise<"cancelled">((resolve) => {
    unsubscribe = deps.onCancel(() => resolve("cancelled"));
  });
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), PROOF_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
  });
  let finished: Promise<"finished" | "threw">;
  try {
    finished = deps.authenticate().then(
      () => "finished" as const,
      () => "threw" as const,
    );
  } catch {
    finished = Promise.resolve("threw" as const);
  }

  try {
    const outcome = await Promise.race([finished, cancelled, timedOut]);
    if (covered()) return "proven";
    // authenticateUser throws only before it prompts.
    if (outcome === "threw") return "unavailable";
    if (outcome === "cancelled") {
      await sleep(PROOF_CANCEL_GRACE_MS);
      return covered() ? "proven" : "declined";
    }
    return "declined";
  } finally {
    unsubscribe();
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ------------------------------------------------ the prover the app mounts

type Prover = ProveSessionFn;

let prover: Prover | null = null;

/** Mount the app's prover (components/SessionProofSheet.tsx). Returns the
 *  unregister, which only removes this prover, never a newer one. */
export function registerSessionProver(next: Prover): () => void {
  prover = next;
  return () => {
    if (prover === next) prover = null;
  };
}

/**
 * The ProveSessionFn every wallet-auth requester is bound to. "unavailable"
 * until the app mounts a prover (no Dynamic, or before hydration), so a
 * caller falls back to the plain signature instead of hanging.
 */
export const proveRegisteredSession: ProveSessionFn = async (address, options) => {
  if (prover === null) return "unavailable";
  try {
    return await prover(address, options);
  } catch {
    return "unavailable";
  }
};

/**
 * The proof, asked about first. Unless the request is `confirmed` (a Verify
 * tap whose explanation is on screen), the player sees one plain line and
 * says yes before the wallet opens: never a cold popup, whichever surface
 * asked. Nothing is asked when nothing would open (already proven, or the
 * proof cannot run). Dynamic's state is re-read after the answer, because the
 * player may take a while and the sign-in hook from before can be stale.
 */
export async function proveWithConfirmation(params: {
  confirmed: boolean;
  readDeps: () => SessionProofDeps | null;
  confirm: () => Promise<boolean>;
}): Promise<SessionProofResult> {
  const before = params.readDeps();
  if (before === null) return "unavailable";
  const pre = sessionProofPrecheck(before);
  if (pre !== "ask") return pre;
  if (!params.confirmed) {
    let yes = false;
    try {
      yes = (await params.confirm()) === true;
    } catch {
      yes = false;
    }
    if (!yes) return "dismissed";
  }
  const after = params.readDeps();
  if (after === null) return "unavailable";
  return runSessionProof(after);
}

// ------------------------------------------------ the question, in the page
//
// One question at a time, shared by every surface that asks: the sheet
// renders it, the player answers it, and every waiting request gets the same
// answer. Without a mounted sheet (no Dynamic, node tests, the e2e suite)
// there is nobody to ask and every request goes ahead, exactly as before.

export interface PendingPrompt {
  address: string;
  kind: PromptKind;
}

/**
 * After a Not now, a question for the same wallet that arrives within this
 * long of the last one is answered no without showing, and pushes the window
 * on. A claim loop polls every 800ms for minutes with a prompting requester;
 * without this the sheet would come straight back after every no. A tap once
 * the asking has stopped is asked again, so a no is never forever.
 */
export const PROMPT_QUIET_MS = 3_000;

let gateMounted = 0;
let question: { prompt: PendingPrompt; waiters: Array<(yes: boolean) => void> } | null = null;
let lastNo: { address: string; at: number } | null = null;
const promptListeners = new Set<() => void>();

function notifyPrompt(): void {
  for (const listener of [...promptListeners]) listener();
}

/** The question on screen, or null. */
export function pendingPrompt(): PendingPrompt | null {
  return question === null ? null : question.prompt;
}

/** Subscribe to the question changing; returns the unsubscribe. */
export function subscribePrompt(listener: () => void): () => void {
  promptListeners.add(listener);
  return () => {
    promptListeners.delete(listener);
  };
}

/** The player's answer to the question on screen. */
export function answerPrompt(yes: boolean): void {
  if (question === null) return;
  const { waiters, prompt } = question;
  question = null;
  lastNo = yes ? null : { address: prompt.address.toLowerCase(), at: Date.now() };
  for (const resolve of waiters) resolve(yes);
  notifyPrompt();
}

/** Mount the sheet that renders the question. Returns the unmount, which
 *  answers an open question with a no so no caller waits forever. */
export function registerPromptGate(): () => void {
  gateMounted += 1;
  let mounted = true;
  return () => {
    if (!mounted) return;
    mounted = false;
    gateMounted -= 1;
    if (gateMounted === 0) answerPrompt(false);
  };
}

/** The ConfirmPromptFn every wallet-auth requester is bound to. */
export const confirmRegisteredPrompt: ConfirmPromptFn = (address, kind) => {
  if (gateMounted === 0) return Promise.resolve(true);
  const now = Date.now();
  if (
    question === null &&
    lastNo !== null &&
    lastNo.address === address.toLowerCase() &&
    now - lastNo.at < PROMPT_QUIET_MS
  ) {
    // Still being asked right after a no: the same no, and the window moves on.
    lastNo = { address: lastNo.address, at: now };
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    if (question !== null && !sameAddress(question.prompt.address, address)) {
      // A question left over for another wallet (the player switched): no.
      answerPrompt(false);
    }
    if (question === null) {
      question = { prompt: { address, kind }, waiters: [resolve] };
      notifyPrompt();
    } else {
      question.waiters.push(resolve);
    }
  });
};

// ------------------------------------------- Dynamic's modal-closed signal

const closeListeners = new Set<() => void>();

/** Called by the React bridge on Dynamic's authFlowClose event. */
export function notifyAuthFlowClosed(): void {
  for (const listener of [...closeListeners]) listener();
}

/** SessionProofDeps.onCancel for the real app. */
export function onAuthFlowClosed(listener: () => void): () => void {
  closeListeners.add(listener);
  return () => {
    closeListeners.delete(listener);
  };
}

/** Test seam. */
export function resetSessionProofs(): void {
  inflight = null;
  prover = null;
  closeListeners.clear();
  gateMounted = 0;
  question = null;
  lastNo = null;
  promptListeners.clear();
}

// ------------------------------------------------------------ the actions

/**
 * The explained sheet's action: the session proof and nothing else, so its
 * "once per session" line is never followed by an eight-minute signature. A
 * decline is remembered so ordinary taps sign instead of reopening the proof.
 */
export async function proveWalletSession(
  address: string | null,
  prove: ProveSessionFn,
): Promise<SessionProofResult> {
  if (address === null) return "unavailable";
  let result: SessionProofResult;
  try {
    // The sheet's own Verify tap, under its own explanation: confirmed.
    result = await prove(address, { confirmed: true });
  } catch {
    result = "unavailable";
  }
  if (result === "declined") rememberSessionProofDecline(address);
  if (result === "proven") forgetSessionProofDecline(address);
  return result;
}

/**
 * Every react-query root whose answer changes once the wallet is proven. Each
 * of these reads is cachedOnly on load, so it shows "locked" until a proof
 * exists and must be re-read the moment one does.
 */
export const WALLET_GATED_QUERY_ROOTS: readonly string[] = [
  "claim-ledger",
  "invited-challenges",
  "wearable-data",
  "wearable-progress",
  "wearable-providers",
];

/** Re-read every wallet-gated query. `invalidate` gets one root at a time. */
export async function invalidateWalletGatedReads(
  invalidate: (root: string) => Promise<unknown> | void,
): Promise<void> {
  await Promise.all(
    WALLET_GATED_QUERY_ROOTS.map(async (root) => {
      try {
        await invalidate(root);
      } catch {
        // A failed refetch shows its own state; it is not this tap's error.
      }
    }),
  );
}

/**
 * The quiet "Verify wallet" action on locked data. Clears a remembered
 * decline first (this is the one tap whose whole job is verifying), asks for
 * a fresh credential (the session proof, or the signature where the proof
 * cannot run), re-reads the locked data on success, and returns the line to
 * show, or null when verified. Never throws into a click handler.
 */
export async function runVerifyWallet(params: {
  address: string | null;
  requestAuth: WalletAuthRequester;
  invalidate: (root: string) => Promise<unknown> | void;
}): Promise<string | null> {
  if (params.address !== null) forgetSessionProofDecline(params.address);
  let auth: ClientAuth;
  try {
    // The explanation sits right above this button: the tap is the yes.
    auth = await params.requestAuth({ refresh: true, confirmed: true });
  } catch {
    auth = { kind: "failed", message: "" };
  }
  if (auth.kind === "ok") await invalidateWalletGatedReads(params.invalidate);
  return verifyOutcomeLine(auth);
}

/** Whether the explained sheet shows: right after an explicit external-wallet
 *  connect, only where the session proof can run, never over Dynamic's modal,
 *  and never again once proven, dismissed or done. */
export function proofSheetVisible(params: {
  intended: boolean;
  canProve: boolean;
  sessionProven: boolean;
  dismissed: boolean;
  done: boolean;
  authFlowOpen?: boolean;
}): boolean {
  return (
    params.intended &&
    params.canProve &&
    !params.sessionProven &&
    !params.dismissed &&
    !params.done &&
    params.authFlowOpen !== true
  );
}
