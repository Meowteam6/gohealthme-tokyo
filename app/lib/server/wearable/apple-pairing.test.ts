// Pairing the iPhone app to a wallet. Pinned here:
//
//   - a code works once, and of two phones racing it exactly one wins
//   - a code is bound to the wallet that minted it; nothing the phone sends
//     can pick a different wallet
//   - pairing a second phone revokes the first
//   - every failure looks the same to a guesser
//   - a fresh device is unconfirmed, so its first sync records the provider
//   - a wallet knows whether a phone holds a token for it, before any data
//     arrives, so the web can hold on "waiting for the first sync" instead of
//     telling the person their code expired
//   - forgetting a wallet revokes its phone: the next post is refused and the
//     table cannot refill behind a person who asked to be forgotten

import { describe, it, expect } from "vitest";

import {
  confirmDevice,
  deviceExistsFor,
  deviceForToken,
  mintPairingCode,
  normalizePairingCode,
  readDeviceToken,
  redeemPairingCode,
  revokeDevicesFor,
} from "@/lib/server/wearable/apple-pairing";

function wallet(): string {
  const hex = Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  return `0x${hex}`;
}

describe("apple pairing", () => {
  it("mints a readable code with a deep link and a ten minute expiry", async () => {
    const now = Date.now();
    const p = await mintPairingCode(wallet(), now);
    expect(p.code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(p.deepLink).toBe(`gohealthme://pair?code=${encodeURIComponent(p.code)}`);
    expect(p.expiresAt).toBe(now + 10 * 60 * 1000);
  });

  it("redeems for a device token bound to the minting wallet", async () => {
    const address = wallet();
    const { code } = await mintPairingCode(address);
    const result = await redeemPairingCode(code.toLowerCase().replace("-", " "));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.address.toLowerCase()).toBe(address);
    const device = await deviceForToken(result.deviceToken);
    expect(device?.address.toLowerCase()).toBe(address);
    expect(device?.confirmed).toBe(false);
  });

  it("works once, even when two phones race it", async () => {
    const { code } = await mintPairingCode(wallet());
    const [a, b] = await Promise.all([redeemPairingCode(code), redeemPairingCode(code)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect((await redeemPairingCode(code)).ok).toBe(false);
  });

  it("refuses an unknown or malformed code with the same answer", async () => {
    expect(await redeemPairingCode("ZZZZ-ZZZZ")).toEqual({ ok: false, reason: "invalid" });
    expect(await redeemPairingCode("0000-1111")).toEqual({ ok: false, reason: "invalid" });
    expect(await redeemPairingCode("")).toEqual({ ok: false, reason: "invalid" });
  });

  it("revokes the previous phone when the wallet pairs another", async () => {
    const address = wallet();
    const first = await redeemPairingCode((await mintPairingCode(address)).code);
    const second = await redeemPairingCode((await mintPairingCode(address)).code);
    if (!first.ok || !second.ok) throw new Error("pairing failed");
    expect(await deviceForToken(first.deviceToken)).toBeNull();
    expect(await deviceForToken(second.deviceToken)).not.toBeNull();
  });

  it("a confirmed device stays confirmed; a revoked one cannot be confirmed back to life", async () => {
    const address = wallet();
    const first = await redeemPairingCode((await mintPairingCode(address)).code);
    if (!first.ok) throw new Error("pairing failed");
    await confirmDevice(first.deviceToken);
    expect((await deviceForToken(first.deviceToken))?.confirmed).toBe(true);

    const second = await redeemPairingCode((await mintPairingCode(address)).code);
    if (!second.ok) throw new Error("pairing failed");
    await confirmDevice(first.deviceToken);
    expect(await deviceForToken(first.deviceToken)).toBeNull();
  });

  it("rejects a token that was never issued", async () => {
    expect(await deviceForToken("x".repeat(43))).toBeNull();
    expect(await deviceForToken("short")).toBeNull();
  });

  describe("deviceExistsFor: has a phone redeemed a code for this wallet", () => {
    it("is false before any pairing and after a code is only minted", async () => {
      const address = wallet();
      expect(await deviceExistsFor(address)).toBe(false);
      await mintPairingCode(address);
      // Minting proves nothing about a phone; only redeeming does.
      expect(await deviceExistsFor(address)).toBe(false);
    });

    it("is true once a phone redeemed the code, confirmed or not", async () => {
      const address = wallet();
      const paired = await redeemPairingCode((await mintPairingCode(address)).code);
      if (!paired.ok) throw new Error("pairing failed");
      expect(await deviceExistsFor(address)).toBe(true);
      await confirmDevice(paired.deviceToken);
      expect(await deviceExistsFor(address)).toBe(true);
    });

    it("answers for the wallet whatever the address casing", async () => {
      const address = wallet();
      await redeemPairingCode((await mintPairingCode(address)).code);
      expect(await deviceExistsFor(address.toUpperCase().replace("0X", "0x"))).toBe(true);
    });
  });

  describe("revokeDevicesFor: forgetting a wallet cuts its phone off", () => {
    it("refuses the old token afterwards and reports no device", async () => {
      const address = wallet();
      const paired = await redeemPairingCode((await mintPairingCode(address)).code);
      if (!paired.ok) throw new Error("pairing failed");
      await confirmDevice(paired.deviceToken);

      await revokeDevicesFor(address);

      // The sync route turns a null here into its 401 "pair again" answer,
      // so the phone goes back to its pair screen instead of refilling the
      // table on its next background wake.
      expect(await deviceForToken(paired.deviceToken)).toBeNull();
      expect(await deviceExistsFor(address)).toBe(false);
    });

    it("is idempotent, including for a wallet that never paired", async () => {
      const address = wallet();
      await expect(revokeDevicesFor(address)).resolves.toBeUndefined();
      await expect(revokeDevicesFor(address)).resolves.toBeUndefined();
      expect(await deviceExistsFor(address)).toBe(false);
    });

    it("leaves the wallet free to pair a new phone", async () => {
      const address = wallet();
      const first = await redeemPairingCode((await mintPairingCode(address)).code);
      if (!first.ok) throw new Error("pairing failed");
      await revokeDevicesFor(address);

      const second = await redeemPairingCode((await mintPairingCode(address)).code);
      if (!second.ok) throw new Error("re-pairing failed");
      expect(await deviceForToken(first.deviceToken)).toBeNull();
      expect((await deviceForToken(second.deviceToken))?.confirmed).toBe(false);
      expect(await deviceExistsFor(address)).toBe(true);
    });

    it("touches only the wallet it was asked about", async () => {
      const a = wallet();
      const b = wallet();
      const pairedB = await redeemPairingCode((await mintPairingCode(b)).code);
      if (!pairedB.ok) throw new Error("pairing failed");
      await redeemPairingCode((await mintPairingCode(a)).code);

      await revokeDevicesFor(a);

      expect(await deviceExistsFor(a)).toBe(false);
      expect(await deviceExistsFor(b)).toBe(true);
      expect(await deviceForToken(pairedB.deviceToken)).not.toBeNull();
    });
  });

  it("normalizes codes and reads bearer tokens", () => {
    expect(normalizePairingCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizePairingCode("abcd-efg")).toBeNull();
    const req = new Request("https://x.test", { headers: { authorization: "Bearer abc" } });
    expect(readDeviceToken(req)).toBe("abc");
    expect(readDeviceToken(new Request("https://x.test"))).toBeNull();
  });
});
