"use client";

// The sign-in choice, made explicit. A first-time visitor should obviously get
// the wallet we provision for them - the Dynamic embedded wallet from an email
// code, with no seed phrase and no extension - as the default, and reach an
// external wallet (MetaMask, Coinbase) only as a deliberate second choice.
//
// The email path runs through useConnectWithOtp, which NEVER opens Dynamic's
// wallet modal, so an injected browser extension cannot intercept it. Only the
// secondary "Connect your own wallet" button opens the modal (login ->
// setShowAuthFlow), and it first records the deliberate intent so the optional
// injected-wallet guard in providers.tsx lets that connection through while
// still vetoing a silent load-time reconnect.
//
// Hard-won sign-in facts this leaves untouched: connect-only stays on (no SIWE
// signature prompt), walletsFilter still hides MetaMask from the modal list,
// and lib/wallet.ts still resolves primaryWallet ?? userWallets[0]. This panel
// only chooses which flow to start.

import { useState } from "react";
import { useConnectWithOtp } from "@dynamic-labs/sdk-react-core";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { useEmbeddedWallet } from "@/lib/wallet";
import { useBaseAccountConnect } from "@/lib/useBaseAccountConnect";
import { markExternalConnectIntent } from "@/lib/wallet-connect-intent";
import { buttonClasses } from "@/components/ui";
import { FIELD, FIELD_HINT, Notice, QUIET_ACTION } from "@/components/night/kit";

// A well inside whatever card asks for sign-in.
const PANEL =
  "rounded-card bg-surface-raised p-4 shadow-[inset_0_0_0_1px_var(--border-strong)] min-[960px]:p-5";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step =
  | { kind: "email" }
  | { kind: "otp" }
  | { kind: "verifying" };

function SignInPanelInner() {
  const { login } = useEmbeddedWallet();
  const { connectWithEmail, verifyOneTimePassword, retryOneTimePassword } =
    useConnectWithOtp();
  const { connectBase, baseBusy } = useBaseAccountConnect();

  const [step, setStep] = useState<Step>({ kind: "email" });
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const sendCode = async () => {
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await connectWithEmail(trimmed);
      setStep({ kind: "otp" });
    } catch {
      setError("Could not send the code. Check the address and try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const code = otp.trim();
    if (code === "") {
      setError("Enter the code from your email.");
      return;
    }
    setBusy(true);
    setError(null);
    setStep({ kind: "verifying" });
    try {
      // On success the embedded wallet connects and the parent re-renders with
      // an authenticated session, unmounting this panel - nothing to do here.
      await verifyOneTimePassword(code);
    } catch {
      setError("That code did not verify. Check it and try again.");
      setStep({ kind: "otp" });
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    setResent(false);
    try {
      await retryOneTimePassword();
      setResent(true);
    } catch {
      setError("Could not resend the code. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const connectExternal = () => {
    // Record the deliberate choice before opening the modal so the optional
    // injected-wallet guard treats this connection as wanted.
    markExternalConnectIntent();
    login();
  };

  return (
    <div className={PANEL}>
      <h2 className="m-0 text-lg font-semibold leading-tight text-foreground">Sign in</h2>

      {step.kind === "otp" || step.kind === "verifying" ? (
        <div className="mt-4 space-y-3">
          <p className="m-0 text-[0.9375rem] text-muted">
            We sent a code to{" "}
            <span className="break-all font-semibold text-foreground">{email.trim()}</span>.
            Enter it to finish.
          </p>
          <label htmlFor="otp-code" className="sr-only">
            Email verification code
          </label>
          <input
            id="otp-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void verify();
            }}
            placeholder="123456"
            disabled={busy}
            className={`${FIELD} num text-[1.25rem] font-semibold tracking-[0.3em]`}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void verify();
            }}
            className={buttonClasses({ block: true })}
          >
            {step.kind === "verifying" ? "Checking the code" : "Sign me in"}
          </button>
          <div className="flex flex-wrap items-center justify-between gap-x-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void resend();
              }}
              className={QUIET_ACTION}
            >
              Send a new code
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setStep({ kind: "email" });
                setOtp("");
                setResent(false);
                setError(null);
              }}
              className={QUIET_ACTION}
            >
              Use a different email
            </button>
          </div>
          {resent ? (
            <p className="m-0 text-[0.9375rem] text-moonlight" aria-live="polite">
              A new code is on its way.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="m-0 text-[0.9375rem] text-muted">
            The fastest way in is your fingerprint or face. No password to
            remember.
          </p>

          {/* Preferred placement (gas-credit Req 3): the Base Account button
              leads. Brand-correct light treatment per Base's own guidelines - a
              white surface, near-black label, and the #0000FF Base Square with
              8px of separation from the text (gap-2). The white button carries a
              hairline border and a soft shadow only so it reads against the
              white card; the Base colors and mark are untouched. On the night
              field the moon face is that light surface with an ink label, so
              the Base button is the primary here. The SAME button
              creates the account for a first-time visitor and signs in a
              returning one - the connect handler below is unchanged. */}
          <button
            type="button"
            disabled={baseBusy}
            aria-busy={baseBusy}
            onClick={() => {
              // Clear any stale email/OTP error before the Base flow opens; the
              // shared hook owns the connect itself.
              setError(null);
              void connectBase();
            }}
            className={buttonClasses({ block: true })}
          >
            {/* Base's own mark: its brand blue, not a UI colour. */}
            <span
              aria-hidden="true"
              className="h-4 w-4 shrink-0 rounded-[2px] bg-[#0000FF]"
            />
            {baseBusy ? "Opening Base" : "Sign in with Base"}
          </button>
          <p className={FIELD_HINT}>
            New here? This sets up your account. Already have one? The same
            button signs you in.
          </p>

          <div className="flex items-center gap-3 py-1" aria-hidden="true">
            <span className="h-px flex-1 bg-edge" />
            <span className="text-sm text-haze">or use email</span>
            <span className="h-px flex-1 bg-edge" />
          </div>

          <label htmlFor="signin-email" className="sr-only">
            Email address
          </label>
          <input
            id="signin-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void sendCode();
            }}
            placeholder="you@email.com"
            disabled={busy}
            className={FIELD}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void sendCode();
            }}
            className={buttonClasses({ variant: "secondary", block: true })}
          >
            {busy ? "Sending your code" : "Email me a sign-in code"}
          </button>
          <p className={FIELD_HINT}>
            Your wallet is made from your email. No seed phrase, no extension.
          </p>
        </div>
      )}

      {error !== null ? (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      ) : null}

      {step.kind === "email" ? (
        <div className="mt-4 border-t border-edge pt-2">
          <button type="button" onClick={connectExternal} className={QUIET_ACTION}>
            I already have a wallet
          </button>
          <p className="m-0 text-[0.8125rem] leading-[1.45] text-haze">
            MetaMask, Coinbase Wallet or another wallet. Email is the simpler way in.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Sign-in panel. The inner component calls Dynamic hooks, so it is mounted only
 * when Dynamic is configured; unconfigured builds get an honest note instead of
 * a thrown hook.
 */
export default function SignInPanel() {
  if (!DYNAMIC_CONFIGURED) {
    return (
      <Notice tone="limit" title="Sign-in is off on this build">
        Nobody can sign in or play on this build yet.
      </Notice>
    );
  }
  return <SignInPanelInner />;
}
