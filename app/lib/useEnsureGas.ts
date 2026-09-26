"use client";

import { useCallback, useState } from "react";
import { getArcPublicClient } from "@/lib/contract";
import { getWalletAuth } from "@/lib/client-auth";
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
      requestAuth: (options) =>
        getWalletAuth({ address, signMessage, refresh: options?.refresh }),
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
