"use client";

// The one explained signature a wallet login gives per session, and the
// bridge that lets the rest of the app ask for it.
//
// Mounted once, inside DynamicContextProvider and QueryClientProvider
// (app/providers.tsx). It does four things:
//
//   1. Registers the session prover (lib/session-proof.ts). Dynamic's
//      authenticateUser lives in a hook, and every wallet-auth requester in
//      the app (useWalletAuth, the gas drip) calls it through this one
//      registration instead of each mounting Dynamic's sign-in hooks.
//   2. Forwards Dynamic's authFlowClose event, which is how a proof learns the
//      player closed Dynamic's modal while the wallet still waited.
//   3. Renders the in-page question every wallet prompt waits on. Whatever
//      asked (a page load, a Join tap, the verdict card, Check my wearable),
//      the wallet opens only after the player reads one plain line here and
//      taps Verify wallet: never a cold popup. Surfaces asking together share
//      one question. A Verify button that already carries the explanation
//      (VerifyWalletAction, this sheet) confirms by itself and skips it.
//   4. Right after an explicit external-wallet connect (SignInPanel's "I
//      already have a wallet" or "Sign in with Base"), offers the proof
//      unprompted, with the same line. SignInPanel unmounts the moment a
//      wallet connects, which is why this lives here.
//
// Every proof runs from a tap on this sheet or on a Verify button, which is
// also what a Base Account needs: its signature opens a popup, and a popup
// needs a user gesture.
//
// A decline is a state, never a loop: the sheet says so once, with a retry
// and "Not now", and the locked data on the page carries its own quiet
// "Verify wallet" action. Email and passkey logins already hold a session
// token and are never asked. The Dynamic session a proof started outlives a
// reload. Once any proof lands, every wallet-gated read is re-read and every
// request still waiting on the question goes ahead with the new token.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getAuthToken,
  useAuthenticateConnectedUser,
  useDynamicContext,
  useDynamicEvents,
  useUserWallets,
} from "@dynamic-labs/sdk-react-core";
import { Button } from "@/components/ui";
import { QUIET_ACTION } from "@/components/night/kit";
import { useEmbeddedWallet } from "@/lib/wallet";
import { externalConnectIntended } from "@/lib/wallet-connect-intent";
import {
  PROOF_DECLINED_LINE,
  SESSION_PROOF_LINE,
  WALLET_PROOF_LINE,
  answerPrompt,
  confirmRegisteredPrompt,
  invalidateWalletGatedReads,
  notifyAuthFlowClosed,
  onAuthFlowClosed,
  pendingPrompt,
  proofSheetVisible,
  proveWithConfirmation,
  registerPromptGate,
  registerSessionProver,
  subscribePrompt,
  type SessionProofDeps,
} from "@/lib/session-proof";

/** What the prover reads at call time: the latest render's Dynamic state. */
interface ProverInputs {
  address: string | null;
  isEmbedded: boolean | null;
  signedIn: boolean;
  proofWalletAddress: string | null;
  authenticate: () => Promise<void>;
}

/** The sheet's outcome, per wallet, so a different wallet starts fresh. */
interface SheetState {
  wallet: string;
  dismissed: boolean;
  declined: boolean;
  done: boolean;
}

const noPrompt = () => null;

export default function SessionProofSheet() {
  const { user, showAuthFlow } = useDynamicContext();
  const userWallets = useUserWallets();
  const { authenticateUser } = useAuthenticateConnectedUser();
  const { address, isEmbedded, sessionProven, sessionProofPossible, proveSession } =
    useEmbeddedWallet();
  const queryClient = useQueryClient();
  const titleId = useId();

  useDynamicEvents("authFlowClose", notifyAuthFlowClosed);

  // --- 1. the prover every requester calls
  const signedIn = user != null;
  const proofWalletAddress = signedIn ? null : (userWallets[0]?.address ?? null);
  const inputs = useRef<ProverInputs | null>(null);
  // Layout effects, all three: they land before any passive effect in the
  // page (a card that asks on mount), so no request can find the prover or
  // the question missing and open the wallet unexplained.
  useLayoutEffect(() => {
    inputs.current = {
      address,
      isEmbedded,
      signedIn,
      proofWalletAddress,
      authenticate: authenticateUser,
    };
  });
  useLayoutEffect(
    () =>
      registerSessionProver((wanted, options) => {
        const depsFor = (): SessionProofDeps | null => {
          const current = inputs.current;
          if (current === null) return null;
          return {
            wantedAddress: wanted,
            activeAddress: current.address,
            proofWalletAddress: current.proofWalletAddress,
            isEmbedded: current.isEmbedded,
            signedIn: current.signedIn,
            readToken: getAuthToken,
            authenticate: current.authenticate,
            onCancel: onAuthFlowClosed,
          };
        };
        return proveWithConfirmation({
          confirmed: options?.confirmed === true,
          readDeps: depsFor,
          confirm: () => confirmRegisteredPrompt(wanted, "session"),
        });
      }),
    [],
  );

  // --- 3. the question every prompt waits on
  useLayoutEffect(() => registerPromptGate(), []);
  const prompt = useSyncExternalStore(subscribePrompt, pendingPrompt, noPrompt);
  const wallet = address?.toLowerCase() ?? null;
  const promptIsMine = prompt !== null && prompt.address.toLowerCase() === wallet;

  // A question left for a wallet that is no longer the one in hand (a switch,
  // a sign-out) is answered no, so its caller stops waiting.
  useEffect(() => {
    if (prompt !== null && !promptIsMine) answerPrompt(false);
  }, [prompt, promptIsMine]);

  // --- 2. once proven (here, on a Verify tap anywhere, or by an email sign-in
  // finishing), every cachedOnly read that showed "locked" is read again, and
  // a request still waiting on the question goes ahead: it finds the new
  // token and opens nothing. Only on the moment of proving, so a later
  // question for a proven wallet (its token refused) is still asked.
  const provenFor = sessionProven && wallet !== null ? wallet : null;
  const lastProvenFor = useRef<string | null>(provenFor);
  useEffect(() => {
    if (provenFor !== null && provenFor !== lastProvenFor.current) {
      const waiting = pendingPrompt();
      if (waiting !== null && waiting.address.toLowerCase() === provenFor) answerPrompt(true);
      void invalidateWalletGatedReads((root) =>
        queryClient.invalidateQueries({ queryKey: [root] }),
      );
    }
    lastProvenFor.current = provenFor;
  }, [provenFor, queryClient]);

  // --- 4. the offer right after an explicit connect
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = sheet !== null && sheet.wallet === wallet ? sheet : null;

  if (wallet === null || showAuthFlow) return null;

  const asking = promptIsMine ? prompt : null;
  const offering =
    asking === null &&
    proofSheetVisible({
      intended: externalConnectIntended(),
      canProve: sessionProofPossible,
      sessionProven,
      dismissed: mine?.dismissed ?? false,
      done: mine?.done ?? false,
      authFlowOpen: showAuthFlow,
    });

  if (asking === null && !offering) return null;

  // Answering the question also settles the post-connect offer, so it never
  // pops back up behind the proof it just started.
  const answer = (yes: boolean) => {
    setSheet({ wallet, dismissed: true, declined: mine?.declined ?? false, done: false });
    answerPrompt(yes);
  };

  const verify = async () => {
    setBusy(true);
    try {
      const proven = await proveSession();
      setSheet({ wallet, dismissed: false, declined: !proven, done: proven });
    } finally {
      setBusy(false);
    }
  };

  const line =
    asking !== null
      ? asking.kind === "session"
        ? SESSION_PROOF_LINE
        : WALLET_PROOF_LINE
      : mine?.declined === true
        ? PROOF_DECLINED_LINE
        : SESSION_PROOF_LINE;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="animate-rise-in fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[60] mx-auto max-w-[26rem] rounded-card bg-[linear-gradient(180deg,var(--surface-top)_0%,var(--surface)_120px)] p-4 shadow-[inset_0_1px_0_rgba(246,228,182,0.12),inset_0_0_0_1px_var(--border-strong),0_28px_60px_-20px_rgba(0,0,0,0.8)] min-[960px]:p-5"
    >
      <h2 id={titleId} className="m-0 text-lg font-semibold leading-tight text-foreground">
        Verify your wallet
      </h2>
      <p className="m-0 mt-2 text-[0.9375rem] leading-[1.45] text-muted" aria-live="polite">
        {line}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button
          size="sm"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            if (asking !== null) answer(true);
            else void verify();
          }}
        >
          {busy ? "Waiting for your wallet" : "Verify wallet"}
        </Button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (asking !== null) answer(false);
            else
              setSheet({
                wallet,
                dismissed: true,
                declined: mine?.declined ?? false,
                done: false,
              });
          }}
          className={QUIET_ACTION}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
