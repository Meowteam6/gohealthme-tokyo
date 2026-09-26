// Pure ENSv2 naming rules for GoHealthMe: which names exist, how a label is
// checked, and the byte encodings the ENSv2 Sepolia contracts expect.
//
// Nothing here touches the network or an env var, so every rule is
// unit-testable under vitest's node environment and shared verbatim by the
// browser claim form, the signed API routes, the settlement receipt writer and
// the bootstrap script. Chain-specific addresses live in
// lib/server/ens/deployments.ts; this file only knows how to spell things.
//
// The name tree (parent is ENS_PARENT_NAME, default gohealthme.eth):
//
//   gohealthme.eth                 owner key, own UserRegistry + PermissionedResolver
//   spotter.gohealthme.eth         the settlement agent, holds no registry roles
//   pool-<id>.gohealthme.eth       one per Base Sepolia pool, created lazily
//   <label>.gohealthme.eth         a participant, minted at character creation
//
// Records carry money facts and tx hashes only. There is no health data key
// and this module refuses to define one.

import {
  encodeFunctionData,
  keccak256,
  numberToHex,
  pad,
  stringToBytes,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  labelhash,
  namehash,
  normalize,
  packetToBytes,
  toCoinType,
} from "viem/ens";
import { RESERVED_HANDLES } from "@/lib/social";

// ------------------------------------------------------------------ chains

export const SEPOLIA_CHAIN_ID = 11155111;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

/** ENSIP-9 coin type for an EVM address on Ethereum. */
export const ETH_COIN_TYPE = 60n;
/** ENSIP-11 coin type for Base Sepolia (0x80000000 | 84532). */
export const BASE_SEPOLIA_COIN_TYPE: bigint = toCoinType(BASE_SEPOLIA_CHAIN_ID);

// ------------------------------------------------------------------- labels

export const DEFAULT_PARENT_NAME = "gohealthme.eth";
export const AGENT_LABEL = "spotter";
export const POOL_LABEL_PREFIX = "pool-";

/** Shown when a human has used every gohealthme.eth name pick. */
export const NAME_CAP_REACHED =
  "You have used all your name picks. Keep this one, or link a .eth you already own.";

export const ENS_LABEL_MIN = 3;
export const ENS_LABEL_MAX = 20;
/**
 * Lowercase letters and digits only. This is the intersection of what a
 * GoHealthMe handle allows ([a-z0-9_]) and what an ENS label allows without
 * normalization surprises (underscores are not valid mid-label under ENSIP-15,
 * hyphens are not valid in a handle). One rule, shared by both claim paths,
 * so a name that is accepted here is always both a handle and a subname.
 */
export const ENS_LABEL_PATTERN = /^[a-z0-9]{3,20}$/;

/**
 * Labels no wallet may mint under the parent. The handle reserved list keeps
 * a wallet from impersonating the product or the agent on /u/[handle]; the
 * extra entries keep the ENS tree itself honest (the agent's own label, the
 * pool prefix, and the TLD-looking words that read as official).
 */
export const RESERVED_LABELS: ReadonlySet<string> = new Set([
  ...RESERVED_HANDLES,
  AGENT_LABEL,
  "pool",
  "pools",
  "eth",
  "ens",
  "agent",
  "receipt",
  "receipts",
  "www",
]);

export type EnsLabelCheck =
  | { ok: true; label: string }
  | { ok: false; reason: string };

/**
 * Validate a requested participant label and return its canonical form. The
 * reason string is user-facing copy, so it stays plain and specific, and it
 * is surfaced BEFORE any signature is asked for: a name that cannot be minted
 * is refused at the form, never after the wallet prompt.
 */
export function checkEnsLabel(raw: string): EnsLabelCheck {
  const label = raw.trim().toLowerCase();
  if (label === "") return { ok: false, reason: "Pick a name." };
  if (label.length < ENS_LABEL_MIN) {
    return {
      ok: false,
      reason: `Names are at least ${ENS_LABEL_MIN} characters.`,
    };
  }
  if (label.length > ENS_LABEL_MAX) {
    return {
      ok: false,
      reason: `Names are at most ${ENS_LABEL_MAX} characters.`,
    };
  }
  if (!ENS_LABEL_PATTERN.test(label)) {
    return {
      ok: false,
      reason: "Use only lowercase letters and numbers.",
    };
  }
  if (label.startsWith(POOL_LABEL_PREFIX) || RESERVED_LABELS.has(label)) {
    return { ok: false, reason: "That name is reserved." };
  }
  // ENSIP-15 normalization is the rule every ENS client applies before
  // resolving. A label that does not survive it would be minted under one
  // spelling and looked up under another.
  let normalized: string;
  try {
    normalized = normalize(label);
  } catch {
    return { ok: false, reason: "That name is not a valid ENS label." };
  }
  if (normalized !== label) {
    return { ok: false, reason: "That name is not a valid ENS label." };
  }
  return { ok: true, label };
}

/** `pool-<id>` for a Base Sepolia pool id. Throws on a non-positive id. */
export function poolLabel(poolId: bigint | number | string): string {
  const id = BigInt(poolId);
  if (id <= 0n) throw new Error(`pool id must be positive, got ${poolId}`);
  return `${POOL_LABEL_PREFIX}${id.toString()}`;
}

/** The pool id a `pool-<id>` label names, or null for anything else. */
export function poolIdFromLabel(label: string): bigint | null {
  const match = /^pool-([1-9][0-9]*)$/.exec(label);
  if (match === null) return null;
  return BigInt(match[1]);
}

export function isPoolLabel(label: string): boolean {
  return poolIdFromLabel(label) !== null;
}

// -------------------------------------------------------------------- names

/** `<label>.<parent>`; the parent is the configured gohealthme.eth. */
export function subname(label: string, parent: string): string {
  return `${label}.${parent}`;
}

export function poolName(poolId: bigint | number | string, parent: string): string {
  return subname(poolLabel(poolId), parent);
}

export function agentName(parent: string): string {
  return subname(AGENT_LABEL, parent);
}

/** The first label of a name: "gohealthme" for "gohealthme.eth". */
export function firstLabel(name: string): string {
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}

/** The label directly under the parent, or null when `name` is not a child. */
export function labelUnder(name: string, parent: string): string | null {
  const suffix = `.${parent}`;
  if (!name.endsWith(suffix)) return null;
  const label = name.slice(0, -suffix.length);
  return label === "" || label.includes(".") ? null : label;
}

// ------------------------------------------------------------- record keys

/**
 * Settlement receipt keys. These are the ONLY text keys the agent's Sepolia
 * signer is delegated to write (Enhanced Access Control on the Permissioned
 * Resolver scopes ROLE_SET_TEXT to keccak256(key)). Anything else it tries -
 * a pool's id, an address record, a name reassignment - reverts on chain.
 */
export const RECEIPT_KEYS = {
  txHash: "gohealthme.settle.tx",
  settledAt: "gohealthme.settle.at",
  settledBy: "gohealthme.settle.by",
  achieverCount: "gohealthme.settle.achievers",
} as const;

export type ReceiptKey = (typeof RECEIPT_KEYS)[keyof typeof RECEIPT_KEYS];

export const RECEIPT_KEY_LIST: readonly ReceiptKey[] = [
  RECEIPT_KEYS.txHash,
  RECEIPT_KEYS.settledAt,
  RECEIPT_KEYS.settledBy,
  RECEIPT_KEYS.achieverCount,
];

/** Pool identity keys, written by the owner key when a pool name is created. */
export const POOL_KEYS = {
  id: "gohealthme.pool.id",
  contract: "gohealthme.pool.contract",
} as const;

export interface SettlementReceipt {
  /** Base Sepolia settle() transaction hash. */
  txHash: Hex;
  /** ISO-8601 instant the receipt was written. */
  settledAt: string;
  /** The Sepolia signer that wrote it (resolves from spotter.gohealthme.eth). */
  settledBy: Address;
  /** How many AchieverPaid payouts the settle emitted. */
  achieverCount: number;
}

/** Encode a receipt as the four text records the agent writes. */
export function encodeReceipt(
  receipt: SettlementReceipt,
): { key: ReceiptKey; value: string }[] {
  return [
    { key: RECEIPT_KEYS.txHash, value: receipt.txHash },
    { key: RECEIPT_KEYS.settledAt, value: receipt.settledAt },
    { key: RECEIPT_KEYS.settledBy, value: receipt.settledBy },
    { key: RECEIPT_KEYS.achieverCount, value: String(receipt.achieverCount) },
  ];
}

/**
 * Decode the four text records back into a receipt. Null when the tx hash is
 * missing (no receipt was ever written); partial records decode to what is
 * there so a half-written receipt is visible rather than hidden.
 */
export function decodeReceipt(
  records: Partial<Record<ReceiptKey, string | null>>,
): SettlementReceipt | null {
  const txHash = records[RECEIPT_KEYS.txHash];
  if (txHash === undefined || txHash === null || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return null;
  }
  const settledBy = records[RECEIPT_KEYS.settledBy] ?? "";
  const count = Number.parseInt(records[RECEIPT_KEYS.achieverCount] ?? "", 10);
  return {
    txHash: txHash as Hex,
    settledAt: records[RECEIPT_KEYS.settledAt] ?? "",
    settledBy: (/^0x[0-9a-fA-F]{40}$/.test(settledBy)
      ? settledBy
      : "0x0000000000000000000000000000000000000000") as Address,
    achieverCount: Number.isFinite(count) && count >= 0 ? count : 0,
  };
}

// ---------------------------------------------------------------- encodings

/** DNS wire format of a name: what every ENSv2 setter and resolve() takes. */
export function dnsEncode(name: string): Hex {
  return toHex(packetToBytes(name));
}

/** ENSIP-1 namehash (the node a resolver keys its record by). */
export function nodeOf(name: string): Hex {
  return namehash(name);
}

/** `LibLabel.id(label)` = uint256(keccak256(bytes(label))). */
export function labelId(label: string): bigint {
  return BigInt(labelhash(label));
}

/** `PermissionedResolverLib.resource(string)` = uint256(keccak256(bytes(s))). */
export function textResource(key: string): bigint {
  return BigInt(keccak256(stringToBytes(key)));
}

/** `PermissionedResolverLib.resource(uint256)` = keccak256 of the 32-byte word. */
export function coinTypeResource(coinType: bigint): bigint {
  return BigInt(keccak256(pad(numberToHex(coinType), { size: 32 })));
}

/** An EVM address as the 20-byte value an addr(coinType) record stores. */
export function addressBytes(address: Address): Hex {
  return address.toLowerCase() as Hex;
}

/** The 20-byte value back to an address, or null when the record is empty. */
export function addressFromBytes(value: Hex | null | undefined): Address | null {
  if (value === undefined || value === null) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  return value as Address;
}

// -------------------------------------------------------------------- roles
//
// Bitmaps from RegistryRolesLib and PermissionedResolverLib at namechain tag
// sepolia-deployment-2026-09-15. A role occupies the low bit of a nybble; its
// admin role is the same bit shifted by 128.

export const ALL_ROLES =
  0x1111111111111111111111111111111111111111111111111111111111111111n;

export function adminOf(role: bigint): bigint {
  return role << 128n;
}

export const RESOLVER_ROLE_SET_ADDRESS = 1n << 0n;
export const RESOLVER_ROLE_SET_TEXT = 1n << 4n;
export const RESOLVER_ROLE_LINK = 1n << 28n;

export const REGISTRY_ROLE_REGISTRAR = 1n << 0n;
export const REGISTRY_ROLE_UNREGISTER = 1n << 12n;
export const REGISTRY_ROLE_SET_SUBREGISTRY = 1n << 20n;
export const REGISTRY_ROLE_SET_RESOLVER = 1n << 24n;
export const REGISTRY_ROLE_CAN_TRANSFER_ADMIN = adminOf(1n << 28n);

/**
 * What a participant gets on their own name token: the same bitmap the
 * ETHRegistrar grants a .eth registrant (re-point the resolver or the
 * subregistry, and transfer). The name is theirs; GoHealthMe only seeds it.
 */
export const PARTICIPANT_NAME_ROLES =
  REGISTRY_ROLE_SET_SUBREGISTRY |
  adminOf(REGISTRY_ROLE_SET_SUBREGISTRY) |
  REGISTRY_ROLE_SET_RESOLVER |
  adminOf(REGISTRY_ROLE_SET_RESOLVER) |
  REGISTRY_ROLE_CAN_TRANSFER_ADMIN;

/**
 * What the agent gets on its own name token: nothing. It owns
 * spotter.gohealthme.eth (the token sits in its wallet) but cannot re-point,
 * transfer or mint. Its only write authority is the per-key resolver grant.
 */
export const AGENT_NAME_ROLES = 0n;

/** Far-future expiry for subnames that should outlive the parent's term. */
export const NO_EXPIRY = 2n ** 64n - 1n;

// ------------------------------------------------------ setter calldata
//
// grantSetterRoles(setter, account) takes the calldata of the setter it is
// delegating, decodes the key (or coin type) out of it, and grants the
// matching role on keccak256(key). The value argument is ignored.

export const RESOLVER_SETTER_ABI = [
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setAddress",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "coinType", type: "uint256" },
      { name: "addressBytes", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export function setTextCalldata(name: string, key: string, value: string): Hex {
  return encodeFunctionData({
    abi: RESOLVER_SETTER_ABI,
    functionName: "setText",
    args: [dnsEncode(name), key, value],
  });
}

export function setAddressCalldata(
  name: string,
  coinType: bigint,
  address: Address,
): Hex {
  return encodeFunctionData({
    abi: RESOLVER_SETTER_ABI,
    functionName: "setAddress",
    args: [dnsEncode(name), coinType, addressBytes(address)],
  });
}

/** The setter calldata grantSetterRoles decodes a text-key grant from. */
export function textSetterGrant(parent: string, key: string): Hex {
  return setTextCalldata(parent, key, "");
}

// ------------------------------------------------------------------ display

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function sepoliaTxUrl(txHash: string): string {
  return `https://sepolia.etherscan.io/tx/${txHash}`;
}

export function sepoliaAddressUrl(address: string): string {
  return `https://sepolia.etherscan.io/address/${address}`;
}

/** The ENS app page for a name on the ENSv2 Sepolia deployment. */
export function ensAppUrl(name: string): string {
  return `https://sepolia.app.ens.domains/${name}`;
}
