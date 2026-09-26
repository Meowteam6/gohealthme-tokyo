// Make sure an unsponsored wallet can pay gas before a money path writes.
//
// A player who signs in with email gets a Dynamic embedded wallet that is a
// plain EOA with 0 Base Sepolia ETH, and the CDP paymaster only sponsors smart
// accounts. Every approve from that wallet failed with "gas required exceeds
// allowance (0)", and retrying could never help. ensureGas runs right before
// the first write on every non-sponsored money path: if the wallet is below
// the minimum it signs the wallet-auth message (cached, so usually no prompt),
// asks /api/gas/drip for a little test ETH, and returns only once the wallet
// itself shows enough to pay. A refusal throws GasDripRefusedError, whose
// message is plain copy naming the next step.
//
// Pure over its deps so it is testable in node; lib/useEnsureGas.ts wires it
// to the connected wallet.

import type { Address } from "viem";
import { fetchWithWalletAuth, type ClientAuth } from "@/lib/client-auth";
import { GasDripRefusedError } from "@/lib/tx-errors";

/** Mirrors the server default (GAS_DRIP_MIN_WEI, 0.0002 ETH). The server's
 *  own minimum, returned in every answer, decides when the wait is over. */
export const CLIENT_GAS_MIN_WEI = 200_000_000_000_000n;

/** The single status line money surfaces show while the drip runs. */
export const GAS_DRIP_STATUS_LINE = "Getting you a little test ETH for gas...";

const POLL_MS = 1_500;
const VISIBLE_TIMEOUT_MS = 30_000;

export interface EnsureGasDeps {
  address: Address;
  /** The wallet's native ETH balance on Base Sepolia, in wei. */
  readBalance: () => Promise<bigint>;
  /** Wallet-auth credential (lib/client-auth getWalletAuth, bound). */
  requestAuth: (options?: { refresh?: boolean }) => Promise<ClientAuth>;
  fetchImpl?: typeof fetch;
  /** Receives GAS_DRIP_STATUS_LINE while running, null when done. */
  onStatus: (line: string | null) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface EnsureGasResult {
  dripped: boolean;
  balanceWei: bigint;
}

interface DripAnswer {
  dripped?: boolean;
  balanceWei?: string;
  minWei?: string;
  error?: string;
  reason?: string;
}

function parseWei(value: string | undefined, fallback: bigint): bigint {
  return value !== undefined && /^\d+$/.test(value) ? BigInt(value) : fallback;
}

async function readOrNull(read: () => Promise<bigint>): Promise<bigint | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

export async function ensureGas(deps: EnsureGasDeps): Promise<EnsureGasResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;

  // A failed read is not a reason to skip: the server reads the balance itself.
  const start = await readOrNull(deps.readBalance);
  if (start !== null && start >= CLIENT_GAS_MIN_WEI) {
    return { dripped: false, balanceWei: start };
  }

  deps.onStatus(GAS_DRIP_STATUS_LINE);
  try {
    const auth = await deps.requestAuth();
    if (auth.kind !== "ok") {
      throw new GasDripRefusedError(
        auth.kind === "declined"
          ? "To send you free test ETH for gas we need a quick signature from your wallet. It costs nothing. Tap the button again and approve the signature."
          : "Your wallet could not sign the request for free test ETH, so none was sent. Tap the button again in a moment.",
        "unsigned",
      );
    }

    const { response } = await fetchWithWalletAuth(
      "/api/gas/drip",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: deps.address }),
      },
      (options) => deps.requestAuth(options),
      deps.fetchImpl,
    );

    let body: DripAnswer = {};
    try {
      body = (await response.json()) as DripAnswer;
    } catch {
      body = {};
    }
    if (!response.ok) {
      throw new GasDripRefusedError(
        body.error ??
          "We could not send you test ETH for gas just now. Nothing was sent; tap the button again in a moment.",
        body.reason ?? String(response.status),
      );
    }

    const target = parseWei(body.minWei, CLIENT_GAS_MIN_WEI);
    const reported = parseWei(body.balanceWei, 0n);
    if (body.dripped !== true && reported >= target) {
      return { dripped: false, balanceWei: reported };
    }

    // The server saw the delta on its RPC; wait until the wallet's own RPC
    // does too, so the next estimate does not still read zero.
    const deadline = now() + VISIBLE_TIMEOUT_MS;
    for (;;) {
      const balance = await readOrNull(deps.readBalance);
      if (balance !== null && balance >= target) {
        return { dripped: body.dripped === true, balanceWei: balance };
      }
      if (now() >= deadline) {
        throw new GasDripRefusedError(
          "We sent you test ETH for gas, but your wallet does not show it yet. Give it a minute, then tap the button again.",
          "not-visible",
        );
      }
      await sleep(POLL_MS);
    }
  } finally {
    deps.onStatus(null);
  }
}
