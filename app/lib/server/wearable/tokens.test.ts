import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readJson } from "@/lib/server/store";
import { randomUUID } from "crypto";

// OAuth refresh tokens ARE the user's health data as far as an attacker is
// concerned, so what is pinned here is the security posture, not the plumbing:
// nothing readable hits the store, a tampered record refuses to open rather
// than yielding attacker-chosen values, and a deployment with no key fails
// loudly instead of quietly writing credentials in the clear.

const KEY = Buffer.alloc(32, 7).toString("base64");

// Each test uses a distinct address: the file-backed store persists across
// tests in one process, and a shared address would let one test see another's
// record.
// Salted per RUN, not just per test. The file-backed store under DATA_DIR
// survives between vitest runs, so a counter that restarts at zero hands the
// next run addresses the previous one already wrote token records for - and a
// "never linked" assertion then reads the last run's data and fails.
const RUN_SALT = randomUUID().replace(/-/g, "").slice(0, 12);
let counter = 0;
function nextAddress(): string {
  counter += 1;
  return `0x${RUN_SALT}${counter.toString(16).padStart(28, "0")}`;
}

const TOKENS = {
  accessToken: "access-abc",
  refreshToken: "refresh-xyz",
  expiresAt: Date.now() + 3_600_000,
  scope: "read:sleep offline",
};

const {
  readTokens,
  writeTokens,
  clearTokens,
  withTokenLock,
  tokenStorageConfigured,
} = await import("@/lib/server/wearable/tokens");

beforeEach(() => {
  vi.stubEnv("WEARABLE_TOKEN_KEY", KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("token storage configuration", () => {
  it("refuses a key that is not exactly 32 bytes", () => {
    vi.stubEnv("WEARABLE_TOKEN_KEY", Buffer.alloc(16, 1).toString("base64"));
    expect(tokenStorageConfigured()).toBe(false);
  });

  it("reports unconfigured when the key is absent", () => {
    vi.stubEnv("WEARABLE_TOKEN_KEY", "");
    expect(tokenStorageConfigured()).toBe(false);
  });

  it("accepts hex as well as base64, so either paste works", () => {
    vi.stubEnv("WEARABLE_TOKEN_KEY", "a".repeat(64));
    expect(tokenStorageConfigured()).toBe(true);
  });

  it("throws by name when a write is attempted with no key", async () => {
    vi.stubEnv("WEARABLE_TOKEN_KEY", "");
    await expect(
      writeTokens("whoop", nextAddress(), TOKENS),
    ).rejects.toThrow(/WEARABLE_TOKEN_KEY/);
  });
});

describe("readTokens / writeTokens", () => {
  it("round-trips a record", async () => {
    const address = nextAddress();
    await writeTokens("whoop", address, TOKENS);

    const read = await readTokens("whoop", address);
    expect(read).toMatchObject(TOKENS);
    expect(typeof read?.updatedAt).toBe("number");
  });

  it("writes nothing readable to the store", async () => {
    const address = nextAddress();
    await writeTokens("whoop", address, TOKENS);

    const raw = await readJson<unknown>(
      `wearable-tokens:whoop:${address.toLowerCase()}`,
      null,
    );
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toContain("refresh-xyz");
    expect(serialized).not.toContain("access-abc");
    expect(serialized).not.toContain("read:sleep");
    expect(raw).toMatchObject({ v: 1 });
  });

  it("keys per wallet, so one user's record cannot overwrite another's", async () => {
    const a = nextAddress();
    const b = nextAddress();
    await writeTokens("whoop", a, { ...TOKENS, accessToken: "a-token" });
    await writeTokens("whoop", b, { ...TOKENS, accessToken: "b-token" });

    expect((await readTokens("whoop", a))?.accessToken).toBe("a-token");
    expect((await readTokens("whoop", b))?.accessToken).toBe("b-token");
  });

  it("is case-insensitive on the address", async () => {
    const address = nextAddress();
    await writeTokens("whoop", address, TOKENS);
    expect(await readTokens("whoop", address.toUpperCase())).not.toBeNull();
  });

  it("separates providers holding the same wallet", async () => {
    const address = nextAddress();
    await writeTokens("whoop", address, TOKENS);
    expect(await readTokens("junction", address)).toBeNull();
  });

  it("returns null for a wallet that never linked", async () => {
    expect(await readTokens("whoop", nextAddress())).toBeNull();
  });

  it("treats a record it cannot open as unlinked, and says so in the log", async () => {
    const address = nextAddress();
    await writeTokens("whoop", address, TOKENS);
    // A different key stands in for a tampered record or a rotated secret:
    // GCM authentication fails either way.
    vi.stubEnv("WEARABLE_TOKEN_KEY", Buffer.alloc(32, 9).toString("base64"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    // Unlinked, not a crash: re-linking is the only honest recovery, and an
    // error the user cannot act on would just strand them.
    expect(await readTokens("whoop", address)).toBeNull();
    expect(logged).toHaveBeenCalled();
  });

  it("treats an unsealed record as unlinked rather than trusting it", async () => {
    const address = nextAddress();
    const { writeJson } = await import("@/lib/server/store");
    await writeJson(`wearable-tokens:whoop:${address.toLowerCase()}`, {
      accessToken: "plaintext-smuggled-in",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await readTokens("whoop", address)).toBeNull();
  });
});

describe("clearTokens", () => {
  it("forgets the connection and is safe to repeat", async () => {
    const address = nextAddress();
    await writeTokens("whoop", address, TOKENS);
    await clearTokens("whoop", address);
    expect(await readTokens("whoop", address)).toBeNull();
    await expect(clearTokens("whoop", address)).resolves.toBeUndefined();
  });
});

describe("withTokenLock", () => {
  it("hands the callback the current record and persists what it returns", async () => {
    const address = nextAddress();
    await writeTokens("whoop", address, TOKENS);

    const result = await withTokenLock("whoop", address, async (current) => {
      expect(current?.accessToken).toBe("access-abc");
      return {
        tokens: { ...TOKENS, accessToken: "rotated" },
        result: "done",
      };
    });

    expect(result).toBe("done");
    expect((await readTokens("whoop", address))?.accessToken).toBe("rotated");
  });

  it("leaves the record untouched when the callback returns no tokens", async () => {
    const address = nextAddress();
    await writeTokens("whoop", address, TOKENS);

    await withTokenLock("whoop", address, async () => ({
      tokens: null,
      result: null,
    }));

    expect((await readTokens("whoop", address))?.accessToken).toBe("access-abc");
  });

  it("serialises concurrent rotations so one cannot spend the other's token", async () => {
    const address = nextAddress();
    await writeTokens("whoop", address, TOKENS);
    const seen: string[] = [];

    // WHOOP rotates the refresh token on every refresh and kills the old one,
    // so two unserialised refreshes would leave one caller holding a dead
    // grant and the user disconnected for no reason.
    const rotate = (label: string) =>
      withTokenLock("whoop", address, async (current) => {
        seen.push(`${label}:${current?.refreshToken}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          tokens: { ...TOKENS, refreshToken: `refresh-${label}` },
          result: label,
        };
      });

    await Promise.all([rotate("a"), rotate("b")]);

    // The second caller must have observed the first caller's write, never the
    // original token both started from.
    expect(seen).toHaveLength(2);
    expect(new Set(seen).size).toBe(2);
    expect(seen.filter((entry) => entry.endsWith("refresh-xyz"))).toHaveLength(1);
  });
});
