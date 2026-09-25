// ENSv2 Sepolia deployment (chain 11155111), the 2026-09-15 clean testnet
// deployment ETHGlobal Tokyo judges check.
//
// Every address below was verified on 2026-09-26 two ways: against
// https://docs.ens.domains/learn/deployments/ and with `cast code` on
// https://ethereum-sepolia-rpc.publicnode.com (all seven carry bytecode).
// ABI snippets are transcribed from the namechain repository at tag
// sepolia-deployment-2026-09-15 (contracts/deployments/sepolia/*.json), the
// artifacts that produced these addresses. @ensdomains/ensjs on npm predates
// this deployment and encodes an initialize() that no longer exists on the
// live implementations, so the app talks to the contracts through viem with
// these snippets instead.
//
// Anything GoHealthMe deploys on top (its own UserRegistry and
// PermissionedResolver proxies) is NOT listed here: it is discovered at
// runtime from ETHRegistry.getSubregistry / getResolver so nothing about the
// name tree is hard-coded (lib/server/ens/client.ts).

import type { Address } from "viem";

export const ENS_SEPOLIA_CHAIN_ID = 11155111;

export const ENS_SEPOLIA = {
  /** Deployment date of the contracts below, per the ensjs and namechain tags. */
  deployedOn: "2026-09-15",
  /** UniversalResolverV2: resolveWithGateways / reverseWithGateways. */
  universalResolver:
    "0x5d25c1d6acbb71b7a28aa7899618a3412a8303e3" as Address,
  /** ETHRegistry: the ".eth" registry; getSubregistry("gohealthme"). */
  ethRegistry: "0x657ea849311d3d5823348dded7c2aaafb3ede09e" as Address,
  /** ETHRegistrar: commit / register for second-level .eth names. */
  ethRegistrar: "0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca" as Address,
  /** VerifiableFactory: deployProxy(impl, salt, initData). */
  verifiableFactory: "0x9e726eb570beb6bceb495ab8cda7df517d4e841c" as Address,
  /** UserRegistry implementation the parent's subregistry proxy points at. */
  userRegistryImpl: "0xa80338aaa8d23831cea25e858d1774534abb0263" as Address,
  /** PermissionedResolver implementation the parent's resolver proxy points at. */
  permissionedResolverImpl:
    "0x14f09fd05d4585759e54844dc9b00147131cf243" as Address,
  /** RootRegistry (informational; the universal resolver walks from it). */
  rootRegistry: "0x9703dbd26dab89504490994138cf2c575251a9ce" as Address,
  /** Testnet payment token for registrations; mint() is public. */
  mockUsdc: "0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e" as Address,
} as const;

/** Every address in the table, for the boot-time bytecode check in scripts. */
export const ENS_SEPOLIA_ADDRESSES: readonly { name: string; address: Address }[] = [
  { name: "UniversalResolverV2", address: ENS_SEPOLIA.universalResolver },
  { name: "ETHRegistry", address: ENS_SEPOLIA.ethRegistry },
  { name: "ETHRegistrar", address: ENS_SEPOLIA.ethRegistrar },
  { name: "VerifiableFactory", address: ENS_SEPOLIA.verifiableFactory },
  { name: "UserRegistryImpl", address: ENS_SEPOLIA.userRegistryImpl },
  { name: "PermissionedResolverImpl", address: ENS_SEPOLIA.permissionedResolverImpl },
  { name: "RootRegistry", address: ENS_SEPOLIA.rootRegistry },
  { name: "MockUSDC", address: ENS_SEPOLIA.mockUsdc },
];

// ------------------------------------------------------------- shared bits

const GRANT_TUPLE = {
  type: "tuple[]",
  name: "grants",
  components: [
    { name: "account", type: "address" },
    { name: "roleBitmap", type: "uint256" },
  ],
} as const;

const EAC_ERRORS = [
  {
    type: "error",
    name: "EACUnauthorizedAccountRoles",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
  },
  {
    type: "error",
    name: "EACCannotGrantRoles",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
  },
  {
    type: "error",
    name: "EACCannotRevokeRoles",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
  },
  { type: "error", name: "EACRootResourceNotAllowed", inputs: [] },
  { type: "error", name: "EACInvalidAccount", inputs: [] },
] as const;

const EAC_EVENTS = [
  {
    type: "event",
    name: "EACRolesChanged",
    inputs: [
      { name: "resource", type: "uint256", indexed: true },
      { name: "account", type: "address", indexed: true },
      { name: "oldRoleBitmap", type: "uint256", indexed: false },
      { name: "newRoleBitmap", type: "uint256", indexed: false },
    ],
  },
] as const;

const EAC_VIEWS = [
  {
    type: "function",
    name: "hasRoles",
    stateMutability: "view",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "hasRootRoles",
    stateMutability: "view",
    inputs: [
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "roles",
    stateMutability: "view",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ROOT_RESOURCE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ------------------------------------------------------- registry (v2)
//
// Shared by the ETHRegistry and by GoHealthMe's own UserRegistry proxy: both
// are PermissionedRegistry instances. `anyId` is a label id
// (uint256(keccak256(label))) or a token id.

export const REGISTRY_ABI = [
  ...EAC_ERRORS,
  ...EAC_EVENTS,
  ...EAC_VIEWS,
  {
    type: "error",
    name: "LabelAlreadyRegistered",
    inputs: [{ name: "label", type: "string" }],
  },
  {
    type: "error",
    name: "LabelExpired",
    inputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "error",
    name: "CannotSetPastExpiry",
    inputs: [{ name: "expiry", type: "uint64" }],
  },
  {
    type: "event",
    name: "LabelRegistered",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "labelHash", type: "bytes32", indexed: true },
      { name: "label", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: false },
      { name: "expiry", type: "uint64", indexed: false },
      { name: "sender", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ResolverUpdated",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "resolver", type: "address", indexed: true },
      { name: "sender", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "SubregistryUpdated",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "subregistry", type: "address", indexed: true },
      { name: "sender", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "TokenResource",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "resource", type: "uint256", indexed: true },
    ],
  },
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [GRANT_TUPLE],
    outputs: [],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "registry", type: "address" },
      { name: "resolver", type: "address" },
      { name: "roleBitmap", type: "uint256" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setResolver",
    stateMutability: "nonpayable",
    inputs: [
      { name: "anyId", type: "uint256" },
      { name: "resolver", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setSubregistry",
    stateMutability: "nonpayable",
    inputs: [
      { name: "anyId", type: "uint256" },
      { name: "registry", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "unregister",
    stateMutability: "nonpayable",
    inputs: [{ name: "anyId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getSubregistry",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getResolver",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "findOwner",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "findExpiry",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "findTokenId",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getResource",
    stateMutability: "view",
    inputs: [{ name: "anyId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getOwner",
    stateMutability: "view",
    inputs: [{ name: "anyId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getStatus",
    stateMutability: "view",
    inputs: [{ name: "anyId", type: "uint256" }],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

/** IPermissionedRegistry.Status */
export const REGISTRY_STATUS = {
  AVAILABLE: 0,
  RESERVED: 1,
  REGISTERED: 2,
} as const;

// ------------------------------------------------------------ registrar

export const ETH_REGISTRAR_ABI = [
  {
    type: "error",
    name: "UnexpiredCommitmentExists",
    inputs: [{ name: "commitment", type: "bytes32" }],
  },
  {
    type: "error",
    name: "CommitmentTooNew",
    inputs: [
      { name: "commitment", type: "bytes32" },
      { name: "validFrom", type: "uint64" },
      { name: "blockTimestamp", type: "uint64" },
    ],
  },
  {
    type: "error",
    name: "CommitmentTooOld",
    inputs: [
      { name: "commitment", type: "bytes32" },
      { name: "validTo", type: "uint64" },
      { name: "blockTimestamp", type: "uint64" },
    ],
  },
  {
    type: "error",
    name: "NameNotAvailable",
    inputs: [{ name: "label", type: "string" }],
  },
  {
    type: "event",
    name: "CommitmentMade",
    inputs: [{ name: "commitment", type: "bytes32", indexed: false }],
  },
  {
    type: "event",
    name: "NameRegistered",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "label", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: false },
      { name: "subregistry", type: "address", indexed: false },
      { name: "resolver", type: "address", indexed: false },
      { name: "duration", type: "uint64", indexed: false },
      { name: "paymentToken", type: "address", indexed: false },
      { name: "referrer", type: "bytes32", indexed: true },
      { name: "base", type: "uint256", indexed: false },
      { name: "premium", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "commit",
    stateMutability: "nonpayable",
    inputs: [{ name: "commitment", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "secret", type: "bytes32" },
      { name: "subregistry", type: "address" },
      { name: "resolver", type: "address" },
      { name: "duration", type: "uint64" },
      { name: "paymentToken", type: "address" },
      { name: "referrer", type: "bytes32" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    type: "function",
    name: "makeCommitment",
    stateMutability: "pure",
    inputs: [
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "secret", type: "bytes32" },
      { name: "subregistry", type: "address" },
      { name: "resolver", type: "address" },
      { name: "duration", type: "uint64" },
      { name: "referrer", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "commitmentAt",
    stateMutability: "view",
    inputs: [{ name: "commitment", type: "bytes32" }],
    outputs: [{ name: "commitTime", type: "uint64" }],
  },
  {
    type: "function",
    name: "isAvailable",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getRegisterPrice",
    stateMutability: "view",
    inputs: [
      { name: "label", type: "string" },
      { name: "duration", type: "uint64" },
      { name: "paymentToken", type: "address" },
    ],
    outputs: [
      { name: "base", type: "uint256" },
      { name: "premium", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "MIN_COMMITMENT_AGE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "MAX_COMMITMENT_AGE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "MIN_REGISTER_DURATION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

// ------------------------------------------------- permissioned resolver

export const PERMISSIONED_RESOLVER_ABI = [
  ...EAC_ERRORS,
  ...EAC_EVENTS,
  ...EAC_VIEWS,
  { type: "error", name: "InvalidRecord", inputs: [] },
  {
    type: "error",
    name: "UnsupportedResolverProfile",
    inputs: [{ name: "selector", type: "bytes4" }],
  },
  {
    type: "event",
    name: "TextUpdated",
    inputs: [
      { name: "recordId", type: "uint256", indexed: true },
      { name: "keyHash", type: "string", indexed: true },
      { name: "key", type: "string", indexed: false },
      { name: "value", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AddressUpdated",
    inputs: [
      { name: "recordId", type: "uint256", indexed: true },
      { name: "coinType", type: "uint256", indexed: false },
      { name: "addressBytes", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Linked",
    inputs: [
      { name: "recordId", type: "uint256", indexed: true },
      { name: "node", type: "bytes32", indexed: true },
      { name: "name", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ResourceArgument",
    inputs: [
      { name: "resource", type: "uint256", indexed: true },
      { name: "arg", type: "bytes", indexed: false },
    ],
  },
  {
    type: "function",
    name: "initialize",
    stateMutability: "nonpayable",
    inputs: [GRANT_TUPLE, { name: "calls", type: "bytes[]" }],
    outputs: [],
  },
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
  {
    type: "function",
    name: "multicall",
    stateMutability: "nonpayable",
    inputs: [{ name: "calls", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
  {
    type: "function",
    name: "grantSetterRoles",
    stateMutability: "nonpayable",
    inputs: [
      { name: "setter", type: "bytes" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "revokeRoles",
    stateMutability: "nonpayable",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "linkToNode",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sourceName", type: "bytes" },
      { name: "targetNode", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getRecordId",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "resolve",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes" }],
  },
  {
    type: "function",
    name: "decodeSetter",
    stateMutability: "pure",
    inputs: [{ name: "setter", type: "bytes" }],
    outputs: [
      { name: "arg", type: "bytes" },
      { name: "resource", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
    ],
  },
] as const;

// --------------------------------------------------- verifiable factory

export const VERIFIABLE_FACTORY_ABI = [
  {
    type: "event",
    name: "ProxyDeployed",
    inputs: [
      { name: "sender", type: "address", indexed: false },
      { name: "proxyAddress", type: "address", indexed: false },
      { name: "salt", type: "uint256", indexed: false },
      { name: "implementation", type: "address", indexed: false },
    ],
  },
  {
    type: "function",
    name: "deployProxy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "implementation", type: "address" },
      { name: "salt", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "proxy", type: "address" }],
  },
  {
    type: "function",
    name: "verifyContract",
    stateMutability: "view",
    inputs: [{ name: "proxy", type: "address" }],
    outputs: [{ name: "implementation", type: "address" }],
  },
] as const;

// ------------------------------------------------------------ mock usdc

export const MOCK_USDC_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

// --------------------------------------------------- universal resolver
//
// viem's getEnsText / getEnsAddress / getEnsName carry their own ABI for
// resolveWithGateways and reverseWithGateways; this is only the extra view
// the permission panel and the proof script use to show WHICH resolver a
// name lands on.

export const UNIVERSAL_RESOLVER_ABI = [
  {
    type: "function",
    name: "findResolver",
    stateMutability: "view",
    inputs: [{ name: "name", type: "bytes" }],
    outputs: [
      { name: "resolver", type: "address" },
      { name: "node", type: "bytes32" },
      { name: "offset", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "isENSv2",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
