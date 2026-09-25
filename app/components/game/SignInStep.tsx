"use client";

// Character creation step 1: one way in. An email code makes the wallet (the
// Dynamic embedded wallet), so a family member on a phone never meets a seed
// phrase. Bringing your own wallet stays possible as a quiet link, not a second
// headline button competing with the first.
//
// Hard-won sign-in facts this leaves untouched: the email path runs through
// useConnectWithOtp and never opens Dynamic's modal; only the own-wallet link
// opens it, after recording the deliberate intent the injected-wallet guard in
// providers.tsx reads.

import { useState } from "react";
import { useConnectWithOtp } from "@dynamic-labs/sdk-react-core";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { useEmbeddedWallet } from "@/lib/wallet";
import { markExternalConnectIntent } from "@/lib/wallet-connect-intent";
import { Button, TAP_TARGET } from "@/components/ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputClass =
  "min-h-12 w-full rounded-lg border-2 border-foreground bg-surface px-3 py-3 text-base text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60";

function SignInStepInner() {
  const { login } = useEmbeddedWallet();
  const { connectWithEmail, verifyOneTimePassword, retryOneTimePassword } =
    useConnectWithOtp();
  const [phase, setPhase] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const sendCode = async () => {
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("That does not look like an email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await connectWithEmail(trimmed);
      setPhase("code");
    } catch {
      setError("The code did not send. Check the address and try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (code.trim() === "") {
      setError("Enter the code from your email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // On success the session flips to signed in and this step completes.
      await verifyOneTimePassword(code.trim());
    } catch {
      setError("That code did not match. Check it and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {phase === "email" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode();
          }}
        >
          <label htmlFor="game-email" className="block text-sm font-semibold">
            Your email
          </label>
          <input
            id="game-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            disabled={busy}
            className={inputClass}
          />
          <Button type="submit" pop disabled={busy} className="w-full">
            {busy ? "Sending your code" : "Email me a sign-in code"}
          </Button>
          <p className="text-xs text-muted">
            Your wallet is made from your email. No seed phrase, no extension.
          </p>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <label htmlFor="game-code" className="block text-sm font-semibold">
            Code sent to {email.trim()}
          </label>
          <input
            id="game-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            disabled={busy}
            className={`${inputClass} font-mono tracking-widest`}
          />
          <Button type="submit" pop disabled={busy} className="w-full">
            {busy ? "Checking the code" : "Sign me in"}
          </Button>
          <div className="flex flex-wrap gap-x-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                void retryOneTimePassword()
                  .then(() => setNote("A new code is on its way."))
                  .catch(() => setError("The code did not resend. Try again in a moment."))
                  .finally(() => setBusy(false));
              }}
              className={`-ml-4 text-accent underline underline-offset-2 ${TAP_TARGET}`}
            >
              Send a new code
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPhase("email");
                setCode("");
                setNote(null);
                setError(null);
              }}
              className={`text-muted underline underline-offset-2 ${TAP_TARGET}`}
            >
              Use a different email
            </button>
          </div>
        </form>
      )}
      {note !== null ? (
        <p className="text-sm text-accent" aria-live="polite">
          {note}
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="rounded-lg border-2 border-danger/40 bg-danger/5 p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {phase === "email" ? (
        <button
          type="button"
          onClick={() => {
            markExternalConnectIntent();
            login();
          }}
          className={`-ml-4 text-sm text-muted underline underline-offset-2 hover:text-foreground ${TAP_TARGET}`}
        >
          I already have a wallet
        </button>
      ) : null}
    </div>
  );
}

export default function SignInStep() {
  if (!DYNAMIC_CONFIGURED) {
    // No env names reach the player: say what it means for them.
    return (
      <p className="rounded-lg border-2 border-edge bg-surface-raised p-4 text-sm text-foreground/80">
        Sign-in is not switched on for this build, so nobody can play on it
        yet. The home page still explains how a run works.
      </p>
    );
  }
  return <SignInStepInner />;
}
