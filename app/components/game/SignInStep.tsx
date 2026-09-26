"use client";

// Character creation step 1. The same option stack every other sign-in
// surface shows (SignInOptions in components/SignInPanel.tsx): Sign in with
// Base first, then an email code that makes the wallet (the Dynamic embedded
// wallet, so a family member on a phone never meets a seed phrase), then your
// own wallet as a quiet link. The step's own row already says "Sign in", so
// the stack renders without the panel's card and heading.
//
// Hard-won sign-in facts this leaves untouched: the email path runs through
// useConnectWithOtp and never opens Dynamic's modal; only the own-wallet link
// opens it, after recording the deliberate intent the injected-wallet guard in
// providers.tsx reads.

import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { SignInOptions } from "@/components/SignInPanel";
import { Notice } from "@/components/night/kit";

export default function SignInStep() {
  if (!DYNAMIC_CONFIGURED) {
    // No env names reach the player: say what it means for them.
    return (
      <Notice tone="limit" title="Sign-in is not on for this build">
        Nobody can play on it yet. The home page still explains how a challenge works.
      </Notice>
    );
  }
  return <SignInOptions />;
}
