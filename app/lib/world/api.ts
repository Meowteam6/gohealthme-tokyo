// Browser side of the prove-human routes. Framework-free so every decision
// (what each status code means, how a refusal is rendered) is unit-testable
// under vitest's node environment; ProveHuman.tsx is the thin React binding.
//
// Routes (lib/server/world, docs/WORLD.md):
//   GET  /api/world/rp-context   what to render for this deployment's mode
//   POST /api/world/rp-context   the same plus a fresh signed rp_context (live)
//   POST /api/world/verify       { address, proof } with the wallet signature
//   GET  /api/world/status       { human, verifiedAt?, mode }

import {
  fetchWithWalletAuth,
  type ClientAuth,
  type WalletAuthRequester,
} from "@/lib/client-auth";

export type WorldMode = "live" | "mock" | "off";

export interface RpContext {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
}

export type WorldClientConfig =
  | { mode: "off"; problem: string | null }
  | { mode: "mock"; action: string }
  | {
      mode: "live";
      app_id: `app_${string}`;
      action: string;
      environment: "staging" | "production";
      rp_context?: RpContext;
    };

export type BindConflict = "wallet-has-other-human" | "human-has-other-wallet";

export type VerifyOutcome =
  | {
      ok: true;
      nullifierHash: string;
      mode: "live" | "mock";
      /** The World credential that verified (lib/world/credentials.ts). */
      credential: string | null;
      created: boolean;
    }
  | {
      ok: false;
      /** HTTP status, or 0 when the request never got a verdict (no
       *  signature, network failure). */
      status: number;
      reason: string;
      conflict?: BindConflict;
      otherWallet?: string;
    };

export interface HumanStatusResponse {
  human: "verified" | "unverified";
  verifiedAt?: string;
  mode: WorldMode;
}

async function readConfig(response: Response): Promise<WorldClientConfig> {
  if (!response.ok) {
    throw new Error(`rp-context answered ${response.status}`);
  }
  return (await response.json()) as WorldClientConfig;
}

/** What this deployment supports. Never mints a signature. */
export async function fetchWorldConfig(
  fetchImpl: typeof fetch = fetch,
): Promise<WorldClientConfig> {
  return readConfig(await fetchImpl("/api/world/rp-context"));
}

/** A fresh RP context for opening the widget (live mode). */
export async function mintRpContext(
  fetchImpl: typeof fetch = fetch,
): Promise<WorldClientConfig> {
  return readConfig(
    await fetchImpl("/api/world/rp-context", { method: "POST" }),
  );
}

export async function fetchHumanStatus(
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<HumanStatusResponse> {
  const response = await fetchImpl(
    `/api/world/status?address=${encodeURIComponent(address)}`,
  );
  if (!response.ok) throw new Error(`status answered ${response.status}`);
  return (await response.json()) as HumanStatusResponse;
}

/** Sentence for a wallet-signature attempt that produced no credential. */
export function signatureBlockReason(auth: ClientAuth): string {
  switch (auth.kind) {
    case "ok":
      return "";
    case "no-wallet":
      return "Connect your wallet first. The proof is bound to the wallet you play with.";
    case "unsigned":
    case "declined":
      return "Sign the message in your wallet to confirm it's yours. Nothing is charged and no transaction is sent.";
    case "failed":
      return `Your wallet could not sign: ${auth.message}`;
  }
}

/**
 * Send a proof to the server and read its verdict. Never throws: every
 * outcome is a state the card renders. The server is the only judge here;
 * `ok: true` is only ever what the server said.
 */
export async function submitProof(params: {
  address: string;
  proof: unknown;
  requestAuth: WalletAuthRequester;
  fetchImpl?: typeof fetch;
}): Promise<VerifyOutcome> {
  const { address, proof, requestAuth } = params;
  let response: Response;
  let auth: ClientAuth;
  try {
    ({ response, auth } = await fetchWithWalletAuth(
      "/api/world/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, proof }),
      },
      requestAuth,
      params.fetchImpl ?? fetch,
    ));
  } catch {
    return {
      ok: false,
      status: 0,
      reason: "Could not reach GoHealthMe to check the proof. Check your connection and try again.",
    };
  }
  if (auth.kind !== "ok") {
    return { ok: false, status: 0, reason: signatureBlockReason(auth) };
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (response.ok && body !== null && body.ok === true) {
    return {
      ok: true,
      nullifierHash: String(body.nullifierHash),
      mode: body.mode === "live" ? "live" : "mock",
      credential: typeof body.credential === "string" ? body.credential : null,
      created: body.created === true,
    };
  }

  const reason =
    body !== null && typeof body.error === "string" && body.error !== ""
      ? body.error
      : `Could not verify (HTTP ${response.status}). Try again.`;
  const conflict =
    body?.conflict === "wallet-has-other-human" ||
    body?.conflict === "human-has-other-wallet"
      ? body.conflict
      : undefined;
  const otherWallet =
    typeof body?.otherWallet === "string" ? body.otherWallet : undefined;
  return {
    ok: false,
    status: response.status,
    reason,
    ...(conflict === undefined ? {} : { conflict }),
    ...(otherWallet === undefined ? {} : { otherWallet }),
  };
}
