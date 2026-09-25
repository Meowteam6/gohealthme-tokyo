"use client";

// Lane contract (docs/LANES.md): renders the ENSv2 name for an address, or
// the fallback. Backed by GET /api/ens/resolve?address=, which resolves on
// Sepolia through the universal resolver; nothing here is a lookup table. The
// short address renders immediately and flips to the name when it arrives,
// so a list never waits on the chain to paint.

import { useEffect, useState } from "react";
import { shortAddress } from "@/lib/ens/names";
import {
  cachedName,
  fetchResolvedName,
  resolveOnce,
} from "@/lib/ens/client-cache";

export interface EnsNameProps {
  address: string;
  fallback?: string;
  className?: string;
}

export default function EnsName({ address, fallback, className }: EnsNameProps) {
  const [resolved, setResolved] = useState<{ address: string; name: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (cachedName(address) !== undefined) return;
    resolveOnce(address, fetchResolvedName)
      .then((result) => {
        if (!cancelled) setResolved({ address, name: result });
      })
      .catch(() => {
        // Leave the fallback in place; the next mount retries.
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const memo = cachedName(address);
  const name =
    memo !== undefined
      ? memo
      : resolved !== null && resolved.address === address
        ? resolved.name
        : null;

  const short = shortAddress(address);
  return (
    <span className={className} title={address} data-ens-name={name ?? undefined}>
      {name ?? fallback ?? short}
    </span>
  );
}
