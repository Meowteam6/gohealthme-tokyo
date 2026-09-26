import { describe, it, expect, afterEach, vi } from "vitest";
import { whoopAllowedFor, whoopAllowedWallets } from "@/lib/server/wearable/whoop-allowlist";

afterEach(() => vi.unstubAllEnvs());

const A = "0x8a39a5160Bad34713169ad7eEf9bd779b32c6141";

describe("WHOOP allowlist", () => {
  it("is empty and allows nobody when unset", () => {
    vi.stubEnv("WHOOP_ALLOWED_WALLETS", "");
    expect(whoopAllowedWallets()).toEqual([]);
    expect(whoopAllowedFor(A)).toBe(false);
  });

  it("matches regardless of case and separators", () => {
    vi.stubEnv("WHOOP_ALLOWED_WALLETS", `${A}, 0x1111111111111111111111111111111111111111`);
    expect(whoopAllowedFor(A.toLowerCase())).toBe(true);
    expect(whoopAllowedFor("0x2222222222222222222222222222222222222222")).toBe(false);
    expect(whoopAllowedFor(null)).toBe(false);
  });
});
