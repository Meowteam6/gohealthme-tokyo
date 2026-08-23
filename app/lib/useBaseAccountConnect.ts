"use client";

// The Base Account (Coinbase Smart Wallet) connect flow, extracted so Header and
// SignInPanel share ONE implementation instead of two verbatim copies that were
// free to drift apart. Both call sites keep their own Base brand button; only
// this handler logic lives here.
//
// What this fixes over the two old copies:
//   - No silent failure: a thrown connect error is always logged, so a
//     misconfigured Dynamic dashboard (Coinbase not enabled for the environment)
//     is diagnosable instead of silently degrading to the generic modal.
//   - User-cancel is distinguished from connector-unavailable. Dismissing the
//     passkey/Coinbase popup just clears busy so the SAME Base button can be
//     retried; only a genuine connector failure falls back to the login() modal.
//   - The busy reset is guarded by a mounted ref, because SignInPanel unmounts
//     the instant auth succeeds and the finally block would otherwise setState on
//     an unmounted component.

import { useEffect, useRef, useState } from "react";
import { useWalletOptions } from "@dynamic-labs/sdk-react-core";
import { useEmbeddedWallet } from "@/lib/wallet";
import { markExternalConnectIntent } from "@/lib/wallet-connect-intent";

/**
 * EIP-1193 "user rejected the request" code. Wallets (MetaMask, Coinbase Smart
 * Wallet / passkey) return it when the person dismisses the connect prompt;
 * wagmi/viem surface the same as UserRejectedRequestError.
 */
const USER_REJECTED_CODE = 4001;

const REJECTION_NAME = /UserRejected/i;

const REJECTION_MESSAGE =
  /user rejected|user denied|rejected the request|user closed|popup closed|user cancell?ed|cancell?ed by user|request rejected/i;

/**
 * Whether a thrown connect error is the person deliberately cancelling (they
 * dismissed the passkey/Coinbase popup) rather than a genuine
 * connector-unavailable failure. Walks the cause chain because wagmi/viem nest
 * the useful signal inside `cause`.
 *
 * Detection is intentionally conservative: only errors we can POSITIVELY
 * identify as a rejection are treated as a cancel. Anything else is treated as a
 * real connector failure and falls back to the login() modal, exactly as the two
 * old copies did on every error.
 */
function isUserRejectedConnect(err: unknown): boolean {
  let current: unknown = err;
  let depth = 0;
  while (current !== null && current !== undefined && depth < 10) {
    if (typeof current === "string") {
      return REJECTION_MESSAGE.test(current);
    }
    if (typeof current !== "object") {
      return false;
    }
    const { code, name, message, cause } = current as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (code === USER_REJECTED_CODE || code === String(USER_REJECTED_CODE)) {
      return true;
    }
    if (typeof name === "string" && REJECTION_NAME.test(name)) return true;
    if (typeof message === "string" && REJECTION_MESSAGE.test(message)) {
      return true;
    }
    current = cause;
    depth += 1;
  }
  return false;
}

export interface BaseAccountConnect {
  /** Opens the Base Account (Coinbase Smart Wallet) flow directly. */
  connectBase: () => Promise<void>;
  /** True while the connect is in flight, for the button's busy label. */
  baseBusy: boolean;
}

export function useBaseAccountConnect(): BaseAccountConnect {
  const { login } = useEmbeddedWallet();
  const { selectWalletOption } = useWalletOptions();
  const [baseBusy, setBaseBusy] = useState(false);

  // SignInPanel unmounts the instant auth succeeds, so the finally-block reset
  // could fire on an unmounted component. Guard it: false after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const connectBase = async (): Promise<void> => {
    // Record the deliberate external-connect choice so the optional
    // injected-wallet guard in providers.tsx lets this connection through.
    markExternalConnectIntent();
    setBaseBusy(true);
    try {
      // "coinbase" + coinbaseWalletPreference "smartWalletOnly" (providers.tsx)
      // opens the Base Account (Coinbase Smart Wallet) flow directly; false skips
      // chain selection.
      await selectWalletOption("coinbase", false);
    } catch (err) {
      // NO SILENT FAILURE: always log so a misconfigured Dynamic dashboard
      // (Coinbase not enabled for this environment) is diagnosable.
      console.error("Base Account connect failed", err);
      if (isUserRejectedConnect(err)) {
        // The person dismissed the passkey/Coinbase popup. Do NOT shove a second
        // (generic Dynamic) modal at them - clear busy below so they can retry the
        // same Base button.
      } else {
        // Genuine connector-unavailable/error: fall back to the full auth flow so
        // the button is never a dead end.
        login();
      }
    } finally {
      // Guarded: the panel may already be unmounted after a successful connect.
      if (mountedRef.current) setBaseBusy(false);
    }
  };

  return { connectBase, baseBusy };
}
