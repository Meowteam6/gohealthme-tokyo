// Intercepta (Web3 Antivirus) payout screening client.
//
// One question, asked of mainnet risk data before SPOTTER signs anything that
// pays a wallet: is this address sanctioned, blacklisted or a known scam
// actor? The pools live on Base Sepolia, but the API takes a bare 0x address
// with no chain parameter, so the participant's wallet is screened as the
// mainnet identity it is - which is the point. A testnet demo must not be the
// way a sanctioned address gets paid.
//
// Endpoint (docs.web3antivirus.io/reference/quick-scan-address, read
// 2026-09-26):
//   GET https://api.web3antivirus.io/api/public/v2/extension/account/{address}/quick-scan
//   header X-API-KEY
//   200 -> { toxicScore: number, traits: [{ risk, name, txsCount, description }] }
//   403 -> { status: 403, response: "This authentication key is incorrect or doesn't exist" }
// The docs publish the trait name enum but no score range, so the rule below
// decides on trait NAMES first and only uses the score when an operator sets
// INTERCEPTA_BLOCK_SCORE after calibrating (scripts/intercepta-probe.sh).
//
// Money rule: this module never invents an answer. "unavailable" (timeout,
// 5xx, quota, bad key, unreadable body) is a distinct status the gate treats
// as a hold, never as clear and never as blocked. "unconfigured" (no key) is
// distinct too, so a deployment without screening says so instead of
// pretending it screened. There is no mock in this file; tests inject fetch.

import { getAddress, isAddress, type Address } from "viem";
import { optionalEnv } from "@/lib/server/env";
import { readJson, writeJson } from "@/lib/server/store";
import {
  isRetryableStatus,
  isTransportError,
  withRetry,
} from "@/lib/server/retry";

export type ScreeningStatus = "clear" | "blocked" | "unavailable" | "unconfigured";

export interface ScreeningTrait {
  name: string;
  risk: number;
  txsCount: number;
}

export interface ScreeningResult {
  status: ScreeningStatus;
  /** Checksummed. */
  address: Address;
  /** The provider's toxicScore when it answered, else null. */
  toxicScore: number | null;
  /** Trait names and counts only; the provider's description prose stays out. */
  traits: ScreeningTrait[];
  /** Plain English, composed here from trait names. Safe for any surface. */
  reason: string;
  /** The rule that produced `status`, printed so a reader can check it. */
  rule: string;
  /** ISO-8601 UTC of the live call (or of the cached call). */
  checkedAt: string;
  /** True when served from the per-address cache. */
  cached: boolean;
}

export const INTERCEPTA_DEFAULT_BASE_URL = "https://api.web3antivirus.io";

/** Traits that block a payout on sight. Every name is from the documented
 *  enum. Victim-side traits (attack_money_target, rug_pull_trader) and
 *  exposure-only traits (non_kyc_transfers, suspicious_*_deployer) are
 *  deliberately NOT here: a payout gate must not punish someone for having
 *  been scammed or for using a non-KYC exchange. Override with
 *  INTERCEPTA_BLOCK_TRAITS (comma-separated) after calibrating. */
export const DEFAULT_BLOCK_TRAITS: readonly string[] = [
  "sanction_address",
  "sanction_address_communication",
  "blacklist",
  "known_scammer",
  "initiator_scam_transactions",
  "mixer_transfers",
  "fake_phishing_transfer",
  "fake_phishing_contract_communication",
  "rug_pull",
  "zero_address_risk",
];

/** Definitive answers are reused for an hour per address, across lambdas,
 *  so the 1s claim poll and the 2-minute sweep never burn the key quota on
 *  the same wallet. unavailable is never cached: the next attempt must ask. */
export const SCREEN_CACHE_TTL_MS = 60 * 60 * 1000;

const DEFAULT_TIMEOUT_MS = 5_000;

export interface CachedScreen {
  result: ScreeningResult;
  expiresAt: number;
}

export interface ScreenCache {
  read(address: Address): Promise<CachedScreen | null>;
  write(address: Address, entry: CachedScreen): Promise<void>;
}

function cacheFile(address: Address): string {
  return `intercepta-screen-${address.toLowerCase()}.json`;
}

/** Cache over the shared store (Redis in prod, JSON files locally). Both
 *  sides swallow store failures: a cache that cannot answer degrades to a
 *  live call, never to a wrong answer. */
export function storeScreenCache(): ScreenCache {
  return {
    async read(address) {
      try {
        return await readJson<CachedScreen | null>(cacheFile(address), null);
      } catch {
        return null;
      }
    },
    async write(address, entry) {
      try {
        await writeJson(cacheFile(address), entry);
      } catch {
        // Next caller makes the live call again. Slower, never wrong.
      }
    },
  };
}

/** In-process cache; used by tests and by callers that own their lifetime. */
export function memoryScreenCache(): ScreenCache {
  const entries = new Map<string, CachedScreen>();
  return {
    async read(address) {
      return entries.get(address.toLowerCase()) ?? null;
    },
    async write(address, entry) {
      entries.set(address.toLowerCase(), entry);
    },
  };
}

export interface ScreeningConfig {
  apiKey: string | null;
  baseUrl: string;
  blockTraits: readonly string[];
  /** Block when toxicScore >= this; null means traits alone decide. */
  blockScore: number | null;
  timeoutMs: number;
}

/** Read once per call so a key added to a running deployment takes effect
 *  without a restart, and so tests can stub env per case. */
export function screeningConfig(): ScreeningConfig {
  const apiKey = optionalEnv("INTERCEPTA_API_KEY", "");
  const traitsEnv = optionalEnv("INTERCEPTA_BLOCK_TRAITS", "");
  const blockTraits =
    traitsEnv === ""
      ? DEFAULT_BLOCK_TRAITS
      : traitsEnv
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t !== "");
  const scoreEnv = optionalEnv("INTERCEPTA_BLOCK_SCORE", "");
  const blockScore =
    scoreEnv === "" || !Number.isFinite(Number(scoreEnv))
      ? null
      : Number(scoreEnv);
  const timeoutEnv = Number(optionalEnv("INTERCEPTA_TIMEOUT_MS", ""));
  return {
    apiKey: apiKey === "" ? null : apiKey,
    baseUrl: optionalEnv("INTERCEPTA_BASE_URL", INTERCEPTA_DEFAULT_BASE_URL),
    blockTraits,
    blockScore,
    timeoutMs:
      Number.isFinite(timeoutEnv) && timeoutEnv > 0
        ? timeoutEnv
        : DEFAULT_TIMEOUT_MS,
  };
}

/** True when this deployment has a key and therefore gates payouts. */
export function screeningConfigured(): boolean {
  return screeningConfig().apiKey !== null;
}

/** The rule, printed. Lives on every result and every ledger row so a judge
 *  or an operator can see what turned traits into a verdict. */
export function describeRule(config: ScreeningConfig): string {
  const traits = `block if any trait in {${config.blockTraits.join(", ")}}`;
  return config.blockScore === null
    ? `${traits}; toxicScore is reported, not decisive`
    : `${traits} or toxicScore >= ${config.blockScore}`;
}

export interface QuickScanResponse {
  toxicScore: number;
  traits: ScreeningTrait[];
}

/** Runtime validation of the provider body. The redaction boundary is also
 *  the validation boundary: a body this cannot read is "unavailable", never
 *  a guess. Trait descriptions are dropped here and never stored. */
export function parseQuickScan(body: unknown): QuickScanResponse | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as { toxicScore?: unknown; traits?: unknown };
  if (typeof record.toxicScore !== "number" || !Number.isFinite(record.toxicScore)) {
    return null;
  }
  if (!Array.isArray(record.traits)) return null;
  const traits: ScreeningTrait[] = [];
  for (const raw of record.traits) {
    if (raw === null || typeof raw !== "object") return null;
    const t = raw as { name?: unknown; risk?: unknown; txsCount?: unknown };
    if (typeof t.name !== "string") return null;
    traits.push({
      name: t.name,
      risk: typeof t.risk === "number" ? t.risk : 0,
      txsCount: typeof t.txsCount === "number" ? t.txsCount : 0,
    });
  }
  return { toxicScore: record.toxicScore, traits };
}

/** Apply the printed rule. Pure, so the ledger row and a test agree. */
export function decide(
  scan: QuickScanResponse,
  config: ScreeningConfig,
): { status: "clear" | "blocked"; reason: string } {
  const blockSet = new Set(config.blockTraits);
  const hits = scan.traits.filter((t) => blockSet.has(t.name));
  if (hits.length > 0) {
    const names = hits
      .map((t) => (t.txsCount > 0 ? `${t.name} (${t.txsCount} tx)` : t.name))
      .join(", ");
    return {
      status: "blocked",
      reason: `Intercepta flagged ${names}; toxicScore ${scan.toxicScore}.`,
    };
  }
  if (config.blockScore !== null && scan.toxicScore >= config.blockScore) {
    return {
      status: "blocked",
      reason: `Intercepta toxicScore ${scan.toxicScore} is at or above the block threshold ${config.blockScore}.`,
    };
  }
  const seen =
    scan.traits.length === 0
      ? "no risk traits"
      : `only non-blocking traits (${scan.traits.map((t) => t.name).join(", ")})`;
  return {
    status: "clear",
    reason: `Intercepta reports ${seen}; toxicScore ${scan.toxicScore}.`,
  };
}

class ProviderStatusError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderStatusError";
  }
}

export interface ScreenOptions {
  /** Injected in tests. Defaults to global fetch. */
  fetch?: typeof fetch;
  cache?: ScreenCache;
  now?: () => Date;
  config?: ScreeningConfig;
}

/**
 * Screen one address. Order: unconfigured short-circuit, cache, live call
 * with a 5s timeout and one retry on transport or retryable-status failures,
 * then the printed rule. Only clear and blocked are cached.
 *
 * Throws only on a caller bug (not an EVM address). Every provider-side
 * failure is a returned "unavailable" with the reason in `reason`.
 */
export async function screenAddress(
  rawAddress: string,
  options: ScreenOptions = {},
): Promise<ScreeningResult> {
  if (!isAddress(rawAddress)) {
    throw new TypeError(`screenAddress: ${JSON.stringify(rawAddress)} is not an EVM address`);
  }
  const address = getAddress(rawAddress);
  const config = options.config ?? screeningConfig();
  const rule = describeRule(config);
  const now = options.now ?? (() => new Date());
  const checkedAt = now().toISOString();

  if (config.apiKey === null) {
    return {
      status: "unconfigured",
      address,
      toxicScore: null,
      traits: [],
      reason: "INTERCEPTA_API_KEY is not set on this deployment, so no payout was screened.",
      rule,
      checkedAt,
      cached: false,
    };
  }

  const cache = options.cache ?? storeScreenCache();
  const hit = await cache.read(address);
  if (hit !== null && hit.expiresAt > now().getTime()) {
    return { ...hit.result, cached: true };
  }

  const doFetch = options.fetch ?? fetch;
  const url = `${config.baseUrl.replace(/\/$/, "")}/api/public/v2/extension/account/${address}/quick-scan`;

  let scan: QuickScanResponse;
  try {
    scan = await withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.timeoutMs);
        let res: Response;
        try {
          res = await doFetch(url, {
            method: "GET",
            headers: {
              "X-API-KEY": config.apiKey as string,
              accept: "application/json",
            },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (res.status !== 200) {
          const text = await res.text().catch(() => "");
          throw new ProviderStatusError(
            res.status,
            `Intercepta returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
          );
        }
        const parsed = parseQuickScan(await res.json().catch(() => null));
        if (parsed === null) {
          throw new ProviderStatusError(200, "Intercepta returned a body this client cannot read");
        }
        return parsed;
      },
      {
        attempts: 2,
        backoffMs: [400],
        isRetryable: (err) =>
          isTransportError(err) ||
          (err instanceof ProviderStatusError && isRetryableStatus(err.status)),
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detail =
      err instanceof ProviderStatusError && err.status === 403
        ? "Intercepta rejected the API key (403)."
        : isTransportError(err)
          ? `Intercepta did not answer within ${config.timeoutMs}ms (${message}).`
          : message;
    return {
      status: "unavailable",
      address,
      toxicScore: null,
      traits: [],
      reason: `${detail} Payout held until screening answers.`,
      rule,
      checkedAt,
      cached: false,
    };
  }

  const verdict = decide(scan, config);
  const result: ScreeningResult = {
    status: verdict.status,
    address,
    toxicScore: scan.toxicScore,
    traits: scan.traits,
    reason: verdict.reason,
    rule,
    checkedAt,
    cached: false,
  };
  await cache.write(address, {
    result,
    expiresAt: now().getTime() + SCREEN_CACHE_TTL_MS,
  });
  return result;
}
