// WHOOP's developer app is capped at 10 members on its sandbox tier, so WHOOP
// pairing is offered only to named wallets (Andre and Nikki). Everyone else
// pairs through Junction, which also covers WHOOP straps. Parsed like
// ADMIN_ADDRESSES in lib/server/access.ts.
export function whoopAllowedWallets(): string[] {
  return (process.env.WHOOP_ALLOWED_WALLETS ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s));
}

export function whoopAllowedFor(address: string | null): boolean {
  if (address === null) return false;
  return whoopAllowedWallets().includes(address.toLowerCase());
}
