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

/** The ENS name for an address, or null until (or unless) one resolves. The
 *  same read EnsName draws; for a surface that needs the name as text (an
 *  avatar's initial). Null reads nothing (no wallet yet). */
export function useEnsName(address: string | null): string | null {
  const [resolved, setResolved] = useState<{ address: string; name: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (address === null || cachedName(address) !== undefined) return;
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

  if (address === null) return null;
  const memo = cachedName(address);
  return memo !== undefined
    ? memo
    : resolved !== null && resolved.address === address
      ? resolved.name
      : null;
}

export default function EnsName({ address, fallback, className }: EnsNameProps) {
  const name = useEnsName(address);
  const short = shortAddress(address);
  return (
    <span className={className} title={address} data-ens-name={name ?? undefined}>
      {name ?? fallback ?? short}
    </span>
  );
}
