import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";

// The treasury top-up cron. Pinned after prod logs (2026-09-04) showed it
// asking the CDP faucet every two-to-five minutes, all day, while the treasury
// sat at 58 USDC: the USDC request was refused each time ("faucet limit
// reached") and the ETH request was granted each time, so the cron burned
// faucet quota 288 times a day and piled up ETH it did not need. Two rules
// fix that without touching the money guards: ETH is requested only when the
// treasury's ETH is below a floor, and a refusal starts a cooldown during
// which the cron does nothing but say so.

const treasuryUsdcBalanceUusdc = vi.fn();
const treasuryEthBalanceWei = vi.fn();
const fundTreasuryFromCdpFaucet = vi.fn();

vi.mock("@/app/api/_money/treasury-balance", () => ({
  treasuryAddress: () => "0xd3f3c7813d88946E255005E1b7B49d4995Bd87a5",
  treasuryUsdcBalanceUusdc: (...a: unknown[]) => treasuryUsdcBalanceUusdc(...a),
  treasuryEthBalanceWei: (...a: unknown[]) => treasuryEthBalanceWei(...a),
}));
vi.mock("@/lib/server/cdp-faucet", () => ({
  fundTreasuryFromCdpFaucet: (...a: unknown[]) => fundTreasuryFromCdpFaucet(...a),
}));

const SECRET = "cron-secret-1";

async function loadRoute() {
  vi.stubEnv("DATA_DIR", mkdtempSync(path.join(os.tmpdir(), "treasury-topup-")));
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.resetModules();
  return import("@/app/api/cron/treasury-topup/route");
}

function req(auth?: string) {
  return new Request("http://localhost/api/cron/treasury-topup", {
    method: "GET",
    headers: auth === undefined ? {} : { authorization: auth },
  });
}

const ONE_ETH = 1_000_000_000_000_000_000n;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  fundTreasuryFromCdpFaucet.mockResolvedValue({
    ok: true,
    address: "0xd3f3c7813d88946E255005E1b7B49d4995Bd87a5",
    usdcTxHash: "0xusdc",
  });
});

describe("treasury-topup cron", () => {
  it("rejects a request without the cron bearer", async () => {
    const { GET } = await loadRoute();
    expect((await GET(req())).status).toBe(401);
  });

  it("does nothing at or above the USDC target", async () => {
    const { GET } = await loadRoute();
    treasuryUsdcBalanceUusdc.mockResolvedValue(120_000_000n);
    treasuryEthBalanceWei.mockResolvedValue(ONE_ETH);

    const body = await (await GET(req(`Bearer ${SECRET}`))).json();

    expect(body.toppedUp).toBe(false);
    expect(body.reason).toBe("at or above target");
    expect(fundTreasuryFromCdpFaucet).not.toHaveBeenCalled();
  });

  it("asks for USDC only when the treasury already holds enough ETH", async () => {
    const { GET } = await loadRoute();
    treasuryUsdcBalanceUusdc.mockResolvedValue(58_000_000n);
    treasuryEthBalanceWei.mockResolvedValue(ONE_ETH / 10n); // 0.1 ETH, above the floor

    const body = await (await GET(req(`Bearer ${SECRET}`))).json();

    expect(fundTreasuryFromCdpFaucet).toHaveBeenCalledWith({ includeEth: false });
    expect(body.ethRequested).toBe(false);
  });

  it("asks for ETH too when the treasury's ETH is below the floor", async () => {
    const { GET } = await loadRoute();
    treasuryUsdcBalanceUusdc.mockResolvedValue(58_000_000n);
    treasuryEthBalanceWei.mockResolvedValue(ONE_ETH / 1000n); // 0.001 ETH

    const body = await (await GET(req(`Bearer ${SECRET}`))).json();

    expect(fundTreasuryFromCdpFaucet).toHaveBeenCalledWith({ includeEth: true });
    expect(body.ethRequested).toBe(true);
  });

  it("backs off after a faucet refusal and says so instead of retrying every tick", async () => {
    const { GET } = await loadRoute();
    treasuryUsdcBalanceUusdc.mockResolvedValue(58_000_000n);
    treasuryEthBalanceWei.mockResolvedValue(ONE_ETH);
    fundTreasuryFromCdpFaucet.mockResolvedValue({
      ok: false,
      address: "0xd3f3c7813d88946E255005E1b7B49d4995Bd87a5",
      error: "Project's faucet limit reached for this token and network. Please try again later.",
    });

    const first = await (await GET(req(`Bearer ${SECRET}`))).json();
    expect(first.toppedUp).toBe(false);
    expect(typeof first.cooldownUntil).toBe("string");
    expect(Date.parse(first.cooldownUntil)).toBeGreaterThan(Date.now());

    const second = await (await GET(req(`Bearer ${SECRET}`))).json();
    expect(second.reason).toMatch(/cooling down/);
    expect(second.cooldownUntil).toBe(first.cooldownUntil);
    expect(fundTreasuryFromCdpFaucet).toHaveBeenCalledTimes(1);
  });

  it("does not start a cooldown on a transient error that is not a refusal", async () => {
    const { GET } = await loadRoute();
    treasuryUsdcBalanceUusdc.mockResolvedValue(58_000_000n);
    treasuryEthBalanceWei.mockResolvedValue(ONE_ETH);
    fundTreasuryFromCdpFaucet.mockResolvedValue({
      ok: false,
      address: "0xd3f3c7813d88946E255005E1b7B49d4995Bd87a5",
      error: "fetch failed",
    });

    const body = await (await GET(req(`Bearer ${SECRET}`))).json();

    expect(body.cooldownUntil).toBeNull();
    await GET(req(`Bearer ${SECRET}`));
    expect(fundTreasuryFromCdpFaucet).toHaveBeenCalledTimes(2);
  });
});
