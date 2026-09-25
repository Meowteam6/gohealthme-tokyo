"use client";

// Lane contract (docs/LANES.md): renders the ENSv2 name for an address, or the fallback.
// Backed by GET /api/ens/resolve?address=. The ens lane replaces this file wholesale.

export interface EnsNameProps {
  address: string;
  fallback?: string;
  className?: string;
}

export default function EnsName({ address, fallback, className }: EnsNameProps) {
  const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
  return <span className={className}>{fallback ?? short}</span>;
}
