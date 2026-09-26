"use client";

// Telling somebody, while they are still writing a goal, that their own device
// cannot measure it.
//
// The join gate protects money. This protects something else: a person can
// author "walk 8,000 steps a day for 7 days", create the pool, send the
// challenge link to a named friend, and only discover at the join that their
// own strap has no pedometer. Nothing was charged, so it is not a payment
// trap - it is the other kind of dead end, where you build a thing, name a
// person, share it, and then find out you can never win it yourself.
//
// A WARNING, NOT A BLOCK, and that distinction is deliberate. A sponsor
// funding a pool for other people is not proving a goal and has every right to
// create one their own device cannot verify. Disabling creation would break
// that legitimate case to prevent a surprise. So this says the true thing and
// leaves the decision where it belongs.
//
// It reuses unsupportedMetricFor - the SAME function the join gate calls - so
// the author-time and join-time answers cannot disagree. Two predicates that
// had to agree and did not is how capabilityUnknown and viewerMetricsOf
// drifted, and it is the mistake worth not repeating.

import { useQuery } from "@tanstack/react-query";
import { unsupportedMetricFor } from "@/lib/pool-availability";
import {
  fetchProviderOptions,
  metricLabel,
  providerOptionsQueryKey,
  viewerMetricsOf,
} from "@/lib/wearable-connect";
import { useWalletAuth } from "@/lib/useWalletAuth";
import { useEmbeddedWallet } from "@/lib/wallet";
import { Notice } from "@/components/night/kit";

export default function AuthorCapabilityNotice({
  goalSpec,
  /** What the author is making, so the copy can name it. */
  noun = "run",
}: {
  goalSpec: string;
  noun?: "run" | "challenge";
}) {
  const { address } = useEmbeddedWallet();
  const requestAuth = useWalletAuth();

  // cachedOnly, like every other browse-time capability read: composing a goal
  // is not a request to unlock anything, and a wallet prompt in the middle of
  // typing would be worse than the surprise this prevents.
  const capabilityQuery = useQuery({
    queryKey: providerOptionsQueryKey(address),
    queryFn: () => {
      if (address === null) throw new Error("No wallet connected.");
      return fetchProviderOptions(address, (options) =>
        requestAuth({ ...options, cachedOnly: true }),
      );
    },
    enabled: address !== null,
    retry: false,
    staleTime: 60_000,
  });

  const viewerMetrics = viewerMetricsOf(capabilityQuery.data);
  const unsupported = unsupportedMetricFor(goalSpec, viewerMetrics);

  // Silent unless we actually know the author's device cannot measure this.
  // An unknown capability says nothing here: guessing at somebody mid-sentence
  // would train them to ignore the notice that matters.
  if (unsupported === null) return null;

  const provider = (capabilityQuery.data?.providers ?? []).find(
    (option) => option.id === capabilityQuery.data?.selected,
  );

  return (
    <Notice tone="limit" role="status" className="mt-2">
      This goal is measured in {metricLabel(unsupported)}, and{" "}
      {provider?.label ?? "your wearable"} does not report it. You can still
      create this {noun}, and other players&apos; wearables may measure it, but
      you could not join it yourself without pairing a different wearable.
    </Notice>
  );
}
