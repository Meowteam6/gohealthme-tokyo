"use client";

// The one place a React component gets a wallet-auth requester.
//
// Kept apart from lib/client-auth.ts on purpose: that module is framework-free
// so every decision in it (caching, expiry, rejection classification,
// same-origin attachment, the session proof) is unit-testable under vitest's
// node environment. This file is the thin binding to Dynamic's wallet, and
// holds no decisions of its own.
//
// The returned requester never throws. Dynamic's session token is offered
// first (lib/dynamic-session.ts), so an email or passkey login, and a wallet
// login that proved itself once this session, never see a prompt. A wallet
// login with no token gets the one session proof (lib/session-proof.ts) on the
// first tap that needs it, and the plain signature only where that proof
// cannot run. Either way the wallet opens only after the in-page question
// (components/SessionProofSheet.tsx), unless the caller passes `confirmed`
// from a Verify button that already explains it. Reads that pass cachedOnly
// never prompt at all.

import { useCallback } from "react";
import {
  walletAuthRequester,
  type ClientAuth,
  type WalletAuthRequester,
} from "@/lib/client-auth";
import { dynamicSession } from "@/lib/dynamic-session";
import { useEmbeddedWallet } from "@/lib/wallet";

export type { ClientAuth, WalletAuthRequester };

export function useWalletAuth(): WalletAuthRequester {
  const { address, getArcWalletClient } = useEmbeddedWallet();

  return useCallback(
    (options?: Parameters<WalletAuthRequester>[0]): Promise<ClientAuth> =>
      walletAuthRequester({
        address,
        ...dynamicSession,
        signMessage:
          address === null
            ? null
            : async (message: string) => {
                const client = await getArcWalletClient();
                return client.signMessage({
                  account: client.account,
                  message,
                });
              },
      })(options),
    [address, getArcWalletClient],
  );
}
