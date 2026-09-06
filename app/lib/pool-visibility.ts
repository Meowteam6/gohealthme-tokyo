import { proofPolicyOf } from "@/lib/contract";

/**
 * Split pools into the ones a participant can actually be verified on and the
 * ones that must not be offered. While the document verifier is off, every
 * pool whose proof floor is an upload (document or self-reported) is hidden:
 * joining it would end in "could not verify" and a refund at period end. The
 * chain is untouched; the sweep still refunds anyone who already joined.
 */
export function hideDocumentPools<T extends { goalSpec: string }>(
  pools: readonly T[],
  documentAvailable: boolean,
): { visible: T[]; hidden: T[] } {
  if (documentAvailable) return { visible: [...pools], hidden: [] };
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const pool of pools) {
    (proofPolicyOf(pool.goalSpec).floor === "wearable" ? visible : hidden).push(
      pool,
    );
  }
  return { visible, hidden };
}
