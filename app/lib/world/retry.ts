// Retry for the prove-human status read. A single failed read of
// GET /api/world/status (a KV blip, a cold start, a proxy rate limit) used to
// land the player on an error state at the join; a couple of quick retries
// absorb the transient cases, and only a read that keeps failing reaches the
// "I could not check" lock, which holds the stake and offers a manual retry.
//
// Pure apart from the injected wait, so it is node-tested.

/** Delays before each retry, in ms. Three attempts in total, about 2s worst case. */
export const HUMAN_STATUS_RETRY_DELAYS_MS: readonly number[] = [400, 1500];

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `attempt` until it resolves, retrying after each delay in `delaysMs`.
 * Rejects with the last error once the delays are spent. `shouldStop` lets the
 * caller abandon a retry loop whose answer nobody wants any more (the wallet
 * changed, the component unmounted).
 */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  options: {
    delaysMs?: readonly number[];
    wait?: (ms: number) => Promise<void>;
    shouldStop?: () => boolean;
  } = {},
): Promise<T> {
  const delays = options.delaysMs ?? HUMAN_STATUS_RETRY_DELAYS_MS;
  const wait = options.wait ?? sleep;
  let lastError: unknown = new Error("no attempt was made");
  for (let i = 0; i <= delays.length; i += 1) {
    if (i > 0) {
      await wait(delays[i - 1]);
      if (options.shouldStop?.() === true) throw lastError;
    }
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}
