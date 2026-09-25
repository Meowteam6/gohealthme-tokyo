// The naming rules and encodings the ENSv2 contracts are called with. Pinned
// against vectors computed once with viem and checked by hand against the
// Solidity (LibLabel.id, PermissionedResolverLib.resource, NameCoder), so a
// silent change in an encoding fails here rather than as a revert on Sepolia.

import { describe, it, expect } from "vitest";
import { toFunctionSelector } from "viem";
import {
  AGENT_NAME_ROLES,
  BASE_SEPOLIA_COIN_TYPE,
  PARTICIPANT_NAME_ROLES,
  RECEIPT_KEYS,
  RECEIPT_KEY_LIST,
  RESOLVER_ROLE_SET_TEXT,
  adminOf,
  addressBytes,
  addressFromBytes,
  agentName,
  checkEnsLabel,
  coinTypeResource,
  decodeReceipt,
  dnsEncode,
  encodeReceipt,
  firstLabel,
  labelId,
  labelUnder,
  nodeOf,
  poolIdFromLabel,
  poolLabel,
  poolName,
  setAddressCalldata,
  setTextCalldata,
  textResource,
  textSetterGrant,
} from "@/lib/ens/names";

const PARENT = "gohealthme.eth";
const WALLET = "0x00000000000000000000000000000000000000a1";

describe("checkEnsLabel", () => {
  it("accepts lowercase letters and digits between 3 and 20 characters", () => {
    expect(checkEnsLabel("ironhabit")).toEqual({ ok: true, label: "ironhabit" });
    expect(checkEnsLabel("  Andre99 ")).toEqual({ ok: true, label: "andre99" });
    expect(checkEnsLabel("abc")).toEqual({ ok: true, label: "abc" });
    expect(checkEnsLabel("a".repeat(20))).toEqual({ ok: true, label: "a".repeat(20) });
  });

  it("refuses the empty, short and long cases with plain reasons", () => {
    expect(checkEnsLabel("")).toEqual({ ok: false, reason: "Pick a name." });
    expect(checkEnsLabel("ab").ok).toBe(false);
    expect(checkEnsLabel("a".repeat(21)).ok).toBe(false);
  });

  it("refuses underscores, hyphens, dots and unicode before any signature", () => {
    for (const bad of ["iron_habit", "iron-habit", "iron.habit", "andré", "iron habit"]) {
      const check = checkEnsLabel(bad);
      expect(check.ok, bad).toBe(false);
      if (!check.ok) expect(check.reason).toBe("Use only lowercase letters and numbers.");
    }
  });

  it("refuses names that would impersonate the product, the agent or a pool", () => {
    for (const reserved of ["spotter", "gohealthme", "admin", "pool", "eth", "www"]) {
      expect(checkEnsLabel(reserved)).toEqual({ ok: false, reason: "That name is reserved." });
    }
  });
});

describe("pool labels", () => {
  it("round-trips a pool id", () => {
    expect(poolLabel(42n)).toBe("pool-42");
    expect(poolLabel(7)).toBe("pool-7");
    expect(poolIdFromLabel("pool-42")).toBe(42n);
    expect(poolName(42n, PARENT)).toBe("pool-42.gohealthme.eth");
  });

  it("rejects anything that is not a canonical pool label", () => {
    expect(poolIdFromLabel("pool-01")).toBeNull();
    expect(poolIdFromLabel("pool-x")).toBeNull();
    expect(poolIdFromLabel("pool-")).toBeNull();
    expect(poolIdFromLabel("spotter")).toBeNull();
    expect(() => poolLabel(0n)).toThrow();
  });
});

describe("name helpers", () => {
  it("builds and splits names under the parent", () => {
    expect(agentName(PARENT)).toBe("spotter.gohealthme.eth");
    expect(firstLabel(PARENT)).toBe("gohealthme");
    expect(labelUnder("ironhabit.gohealthme.eth", PARENT)).toBe("ironhabit");
    expect(labelUnder("a.b.gohealthme.eth", PARENT)).toBeNull();
    expect(labelUnder("ironhabit.other.eth", PARENT)).toBeNull();
  });
});

describe("encodings", () => {
  it("dnsEncode produces DNS wire format (length-prefixed labels, zero terminator)", () => {
    expect(dnsEncode("gohealthme.eth")).toBe("0x0a676f6865616c74686d650365746800");
    expect(dnsEncode("pool-42.gohealthme.eth")).toBe(
      "0x07706f6f6c2d34320a676f6865616c74686d650365746800",
    );
  });

  it("nodeOf is the ENSIP-1 namehash", () => {
    expect(nodeOf("gohealthme.eth")).toBe(
      "0x17f978761c329170afafc2c6b2520574a1d5734b354f1708e64a1f1a7c00c9be",
    );
    expect(nodeOf("spotter.gohealthme.eth")).toBe(
      "0xc39b58b547935e72ff6c17c58b95a2fe2e851ae889626d3c14152e7af10b36e2",
    );
  });

  it("labelId matches LibLabel.id = uint256(keccak256(bytes(label)))", () => {
    expect(labelId("gohealthme")).toBe(
      103963498458154362579519288612373927738051343164695455508929013174760005928502n,
    );
  });

  it("textResource matches PermissionedResolverLib.resource(string)", () => {
    expect(textResource(RECEIPT_KEYS.txHash)).toBe(
      89481898460549781660709528930949747216299423131242725688852030587900288446774n,
    );
  });

  it("coinTypeResource matches PermissionedResolverLib.resource(uint256)", () => {
    expect(coinTypeResource(60n)).toBe(
      BigInt("0xc6bb06cb7f92603de181bf256cd16846b93b752a170ff24824098b31aa008a7e"),
    );
  });

  it("uses the ENSIP-11 coin type for Base Sepolia", () => {
    expect(BASE_SEPOLIA_COIN_TYPE).toBe(2147568180n);
  });

  it("stores and reads EVM addresses as 20 raw bytes", () => {
    expect(addressBytes("0xABCDEF0000000000000000000000000000000001")).toBe(
      "0xabcdef0000000000000000000000000000000001",
    );
    expect(addressFromBytes("0x")).toBeNull();
    expect(addressFromBytes(null)).toBeNull();
    expect(addressFromBytes(WALLET)).toBe(WALLET);
  });
});

describe("setter calldata", () => {
  it("encodes setText and setAddress with the live selectors", () => {
    expect(setTextCalldata("pool-1.gohealthme.eth", "k", "v").slice(0, 10)).toBe(
      toFunctionSelector("setText(bytes,string,string)"),
    );
    expect(setTextCalldata("pool-1.gohealthme.eth", "k", "v").slice(0, 10)).toBe("0xc7279f88");
    expect(setAddressCalldata("x.gohealthme.eth", 60n, WALLET).slice(0, 10)).toBe(
      "0xb4436dde",
    );
  });

  it("a setter grant is setText calldata for the key with an empty value", () => {
    expect(textSetterGrant(PARENT, RECEIPT_KEYS.txHash)).toBe(
      setTextCalldata(PARENT, RECEIPT_KEYS.txHash, ""),
    );
  });
});

describe("roles", () => {
  it("mirrors RegistryRolesLib and PermissionedResolverLib bit positions", () => {
    expect(RESOLVER_ROLE_SET_TEXT).toBe(1n << 4n);
    expect(adminOf(1n << 24n)).toBe(1n << 152n);
    // ETHRegistrar.REGISTRATION_ROLE_BITMAP, what a .eth registrant receives.
    const expected =
      (1n << 20n) | (1n << 148n) | (1n << 24n) | (1n << 152n) | (1n << 156n);
    expect(PARTICIPANT_NAME_ROLES).toBe(expected);
  });

  it("the agent holds no registry roles on its own name", () => {
    expect(AGENT_NAME_ROLES).toBe(0n);
  });
});

describe("receipt encoding", () => {
  const receipt = {
    txHash:
      "0x3e26d9a0e9fb71339323b7bb0754e0bca614ff392ae8cfca72bf17605c8c8c53" as const,
    settledAt: "2026-09-27T01:14:00.000Z",
    settledBy: "0x00000000000000000000000000000000000000b2" as const,
    achieverCount: 2,
  };

  it("writes exactly the four delegated keys", () => {
    const records = encodeReceipt(receipt);
    expect(records.map((r) => r.key)).toEqual([...RECEIPT_KEY_LIST]);
    expect(records).toContainEqual({ key: RECEIPT_KEYS.achieverCount, value: "2" });
  });

  it("round-trips through decodeReceipt", () => {
    const records: Record<string, string> = {};
    for (const { key, value } of encodeReceipt(receipt)) records[key] = value;
    expect(decodeReceipt(records)).toEqual(receipt);
  });

  it("is null without a tx hash and tolerant of a partial write", () => {
    expect(decodeReceipt({})).toBeNull();
    expect(decodeReceipt({ [RECEIPT_KEYS.txHash]: "not-a-hash" })).toBeNull();
    const partial = decodeReceipt({ [RECEIPT_KEYS.txHash]: receipt.txHash });
    expect(partial?.txHash).toBe(receipt.txHash);
    expect(partial?.achieverCount).toBe(0);
    expect(partial?.settledAt).toBe("");
  });
});
