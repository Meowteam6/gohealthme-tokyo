"use client";

import { useCallback, useState } from "react";
import { getArcPublicClient } from "@/lib/contract";
import {
  walletAuthRequester,
  type SignMessageFn,
  type WalletAuthRequester,
} from "@/lib/client-auth";
import { dynamicSession, type DynamicSessionBinding } from "@/lib/dynamic-session";
import { ensureGas, type EnsureGasResult } from "@/lib/ensure-gas";
import type { GaslessStatus } from "@/lib/useGasSponsorship";
import type { ArcWalletClient } from "@/lib/wallet";

export interface UseEnsureGasResult {
  /** GAS_DRIP_STATUS_LINE while a drip runs, otherwise null. */
  dripLine: string | null;
  /**
   * Call on the NON-sponsored path, after the USDC preflight and before the
   * first writeContract. Resolves once the wallet can pay gas; throws
   * GasDripRefusedError (humanized by humanizeTxError) when it cannot get any.
   */
  ensureGas: (walletClient: ArcWalletClient) => Promise<EnsureGasResult>;
}

/**
 * The drip's proof of wallet, on the same credential every private read uses:
 * Dynamic's session token first (an email or passkey login never signs), then
 * the one session proof for a wallet login, and the plain signature only where
 * the proof cannot run, each asked about in the page before the wallet opens
 * (the drip runs off a Join tap, not a Verify tap). It used to sign
 * unconditionally, so an email login met a signature prompt right before its
 * first stake.
 */
export function gasDripAuth(
  address: string,
  signMessage: SignMessageFn,
  session: DynamicSessionBinding,
): WalletAuthRequester {
  return walletAuthRequester({ address, signMessage, ...session });
}

/** Shared by every money path so an unsponsored EOA never hits a 0-gas wall. */
export function useEnsureGas(): UseEnsureGasResult {
  const [dripLine, setDripLine] = useState<string | null>(null);

  const run = useCallback(async (walletClient: ArcWalletClient) => {
    const account = walletClient.account;
    const address = account.address;
    const signMessage = (message: string) =>
      walletClient.signMessage({ account, message });
    return ensureGas({
      address,
      readBalance: () => getArcPublicClient().getBalance({ address }),
      requestAuth: gasDripAuth(address, signMessage, dynamicSession),
      onStatus: setDripLine,
    });
  }, []);

  return { dripLine, ensureGas: run };
}

/** Fold the drip line into the gasless status so GaslessBadge shows it. */
export function withDripLine(
  status: GaslessStatus,
  dripLine: string | null,
): GaslessStatus {
  return dripLine === null ? status : { ...status, dripLine };
}
