// Canonical Base Sepolia RPC access for every server-side module (server only).
//
// This is the fork's canonical name for the shared chain client. The
// implementation lives in ./arc-client (kept under its legacy filename so the
// shared-core modules that import it keep resolving during the Arc -> Base
// migration); it now targets Base Sepolia and reads the BASE_SEPOLIA_RPC_URL
// override. New code should import from here.
//
// The fallback/batch transport and the TTL cache are chain-agnostic and carried
// verbatim. The Arc-specific RPC ordering workarounds were dropped — Base
// Sepolia uses the public endpoints declared in lib/chains.ts.

export {
  arcRpcUrls as baseRpcUrls,
  arcPublicClient as basePublicClient,
  arcWalletClient as baseWalletClient,
  resetArcClients as resetBaseClients,
  ttlCache,
  type TtlCache,
  type TtlCacheOptions,
} from "@/lib/server/arc-client";
