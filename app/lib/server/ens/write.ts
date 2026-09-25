// Writes to GoHealthMe's ENSv2 namespace on Sepolia (server only).
//
// Two signers use these primitives: the owner key (mint pool and participant
// subnames, set their address records) and the agent key (write settlement
// receipts, and nothing else - see receipt.ts). Every write is asserted on
// the event the contract emits for it, never on the transaction succeeding:
// a green transaction that emitted no TextUpdated wrote no record.
//
// Sends from one key are serialized through the shared store lock so two
// lambdas cannot race the same nonce. A caller that cannot get the lock in
// time gets a LockUnavailableError and reports "busy", never a silent skip.

import {
  decodeEventLog,
  type Account,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import {
  BASE_SEPOLIA_COIN_TYPE,
  ETH_COIN_TYPE,
  NO_EXPIRY,
  PARTICIPANT_NAME_ROLES,
  POOL_KEYS,
  addressBytes,
  dnsEncode,
  poolLabel,
  poolName,
  setAddressCalldata,
  setTextCalldata,
  subname,
} from "@/lib/ens/names";
import {
  ensPublicClient,
  ensWalletClient,
  type EnsNamespace,
  type EnsPublicClient,
  type EnsWalletClient,
} from "@/lib/server/ens/client";
import {
  ENS_SEPOLIA,
  PERMISSIONED_RESOLVER_ABI,
  REGISTRY_ABI,
} from "@/lib/server/ens/deployments";
import { withLock } from "@/lib/server/store";

/** How long a write waits for Sepolia inclusion before reporting "sent". */
export const ENS_INCLUSION_TIMEOUT_MS = 75_000;
const WRITE_LOCK_TTL_MS = 120_000;
const WRITE_LOCK_WAIT_MS = 15_000;

export type EnsWriter = Pick<EnsWalletClient, "writeContract">;
export type EnsReaderForWrites = Pick<
  EnsPublicClient,
  "readContract" | "waitForTransactionReceipt" | "getEnsAddress" | "getEnsText"
>;

export interface WriteDeps {
  client: EnsReaderForWrites;
  wallet: EnsWriter;
  account: Account;
  namespace: EnsNamespace;
  /** Serialize sends from this key. Injectable so tests run lock-free. */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
}

export function liveWriteDeps(account: Account, namespace: EnsNamespace): WriteDeps {
  return {
    client: ensPublicClient(),
    wallet: ensWalletClient(account),
    account,
    namespace,
    lock: (fn) =>
      withLock(
        `ens-writer-${account.address.toLowerCase()}`,
        WRITE_LOCK_TTL_MS,
        fn,
        WRITE_LOCK_WAIT_MS,
      ),
  };
}

function locked<T>(deps: WriteDeps, fn: () => Promise<T>): Promise<T> {
  return deps.lock === undefined ? fn() : deps.lock(fn);
}

const ZERO: Address = "0x0000000000000000000000000000000000000000";

// -------------------------------------------------------------- assertions

export class EnsWriteAssertionError extends Error {}

/** The named events a receipt carries, decoded with the given ABI. */
export function decodedEvents(
  receipt: Pick<TransactionReceipt, "logs">,
  abi: typeof PERMISSIONED_RESOLVER_ABI | typeof REGISTRY_ABI,
  address: Address,
): { eventName: string; args: Record<string, unknown> }[] {
  const out: { eventName: string; args: Record<string, unknown> }[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      out.push({
        eventName: decoded.eventName,
        args: (decoded.args ?? {}) as Record<string, unknown>,
      });
    } catch {
      // Not one of ours (ERC1155 transfer, proxy event); skip.
    }
  }
  return out;
}

/** Throws unless every key appears in a TextUpdated event of the receipt. */
export function assertTextUpdated(
  receipt: Pick<TransactionReceipt, "logs" | "status">,
  resolver: Address,
  keys: readonly string[],
  txHash: Hex,
): void {
  if (receipt.status !== "success") {
    throw new EnsWriteAssertionError(`tx ${txHash} reverted`);
  }
  const seen = new Set(
    decodedEvents(receipt, PERMISSIONED_RESOLVER_ABI, resolver)
      .filter((e) => e.eventName === "TextUpdated")
      .map((e) => String(e.args.key)),
  );
  const missing = keys.filter((k) => !seen.has(k));
  if (missing.length > 0) {
    throw new EnsWriteAssertionError(
      `tx ${txHash} succeeded but emitted no TextUpdated for ${missing.join(", ")}`,
    );
  }
}

export function assertAddressUpdated(
  receipt: Pick<TransactionReceipt, "logs" | "status">,
  resolver: Address,
  coinType: bigint,
  txHash: Hex,
): void {
  if (receipt.status !== "success") {
    throw new EnsWriteAssertionError(`tx ${txHash} reverted`);
  }
  const ok = decodedEvents(receipt, PERMISSIONED_RESOLVER_ABI, resolver).some(
    (e) => e.eventName === "AddressUpdated" && BigInt(String(e.args.coinType)) === coinType,
  );
  if (!ok) {
    throw new EnsWriteAssertionError(
      `tx ${txHash} succeeded but emitted no AddressUpdated for coinType ${coinType}`,
    );
  }
}

export function assertLabelRegistered(
  receipt: Pick<TransactionReceipt, "logs" | "status">,
  registry: Address,
  label: string,
  txHash: Hex,
): void {
  if (receipt.status !== "success") {
    throw new EnsWriteAssertionError(`tx ${txHash} reverted`);
  }
  const ok = decodedEvents(receipt, REGISTRY_ABI, registry).some(
    (e) => e.eventName === "LabelRegistered" && e.args.label === label,
  );
  if (!ok) {
    throw new EnsWriteAssertionError(
      `tx ${txHash} succeeded but emitted no LabelRegistered for ${label}`,
    );
  }
}

async function waitFor(deps: WriteDeps, hash: Hex): Promise<TransactionReceipt> {
  return deps.client.waitForTransactionReceipt({
    hash,
    timeout: ENS_INCLUSION_TIMEOUT_MS,
  });
}

// ------------------------------------------------------------- primitives

export type SubnameOutcome =
  | { status: "exists"; owner: Address }
  | { status: "registered"; txHash: Hex; owner: Address };

/**
 * Register <label>.<parent> owned by `owner` with `roleBitmap` on its token,
 * pointing at the namespace resolver. Idempotent: an existing registration
 * is reported, never overwritten (the registry would revert anyway).
 */
export async function ensureSubname(
  deps: WriteDeps,
  input: { label: string; owner: Address; roleBitmap: bigint; expiry?: bigint },
): Promise<SubnameOutcome> {
  const { registry, resolver } = deps.namespace;
  const current = await deps.client.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "findOwner",
    args: [input.label],
  });
  if (current.toLowerCase() !== ZERO) return { status: "exists", owner: current };

  return locked(deps, async () => {
    const txHash = await deps.wallet.writeContract({
      account: deps.account,
      chain: null,
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "register",
      args: [
        input.label,
        input.owner,
        ZERO,
        resolver,
        input.roleBitmap,
        input.expiry ?? NO_EXPIRY,
      ],
    });
    const receipt = await waitFor(deps, txHash);
    assertLabelRegistered(receipt, registry, input.label, txHash);
    return { status: "registered", txHash, owner: input.owner };
  });
}

/** Send one setText per record in a single multicall and assert every key. */
export async function setTextRecords(
  deps: WriteDeps,
  input: { name: string; records: { key: string; value: string }[]; wait?: boolean },
): Promise<{ txHash: Hex; confirmed: boolean }> {
  const { resolver } = deps.namespace;
  const calls = input.records.map((r) => setTextCalldata(input.name, r.key, r.value));
  return locked(deps, async () => {
    const txHash = await deps.wallet.writeContract({
      account: deps.account,
      chain: null,
      address: resolver,
      abi: PERMISSIONED_RESOLVER_ABI,
      functionName: "multicall",
      args: [calls],
    });
    if (input.wait === false) return { txHash, confirmed: false };
    const receipt = await waitFor(deps, txHash);
    assertTextUpdated(
      receipt,
      resolver,
      input.records.map((r) => r.key),
      txHash,
    );
    return { txHash, confirmed: true };
  });
}

/** Set one address record and assert AddressUpdated. */
export async function setAddressRecord(
  deps: WriteDeps,
  input: { name: string; coinType: bigint; address: Address },
): Promise<Hex> {
  const { resolver } = deps.namespace;
  return locked(deps, async () => {
    const txHash = await deps.wallet.writeContract({
      account: deps.account,
      chain: null,
      address: resolver,
      abi: PERMISSIONED_RESOLVER_ABI,
      functionName: "setAddress",
      args: [dnsEncode(input.name), input.coinType, addressBytes(input.address)],
    });
    const receipt = await waitFor(deps, txHash);
    assertAddressUpdated(receipt, resolver, input.coinType, txHash);
    return txHash;
  });
}

// ------------------------------------------------------------ pool names

export type PoolNameOutcome =
  | { status: "exists"; name: string }
  | { status: "created"; name: string; registerTx: Hex | null; recordsTx: Hex };

/**
 * Make pool-<id>.<parent> a real name: registered in GoHealthMe's registry,
 * with addr(84532) = the HealthPools contract and the pool id as a text
 * record, so anyone resolving the name lands on the Base Sepolia pool. Owner
 * key only. Idempotent on the pool.id record.
 */
export async function ensurePoolName(
  deps: WriteDeps,
  input: { poolId: bigint; poolsContract: Address },
): Promise<PoolNameOutcome> {
  const { parentName, resolver } = deps.namespace;
  const label = poolLabel(input.poolId);
  const name = poolName(input.poolId, parentName);

  const existingId = await deps.client
    .getEnsText({
      name,
      key: POOL_KEYS.id,
      universalResolverAddress: ENS_SEPOLIA.universalResolver,
    })
    .catch(() => null);
  const registered = await ensureSubname(deps, {
    label,
    owner: deps.account.address,
    roleBitmap: 0n,
  });
  if (existingId === input.poolId.toString() && registered.status === "exists") {
    return { status: "exists", name };
  }

  const calls = [
    setAddressCalldata(name, BASE_SEPOLIA_COIN_TYPE, input.poolsContract),
    setTextCalldata(name, POOL_KEYS.id, input.poolId.toString()),
    setTextCalldata(name, POOL_KEYS.contract, `eip155:84532:${input.poolsContract}`),
  ];
  const recordsTx = await locked(deps, async () => {
    const txHash = await deps.wallet.writeContract({
      account: deps.account,
      chain: null,
      address: resolver,
      abi: PERMISSIONED_RESOLVER_ABI,
      functionName: "multicall",
      args: [calls],
    });
    const receipt = await waitFor(deps, txHash);
    assertTextUpdated(receipt, resolver, [POOL_KEYS.id, POOL_KEYS.contract], txHash);
    assertAddressUpdated(receipt, resolver, BASE_SEPOLIA_COIN_TYPE, txHash);
    return txHash;
  });
  return {
    status: "created",
    name,
    registerTx: registered.status === "registered" ? registered.txHash : null,
    recordsTx,
  };
}

// ----------------------------------------------------- participant names

export interface MintedName {
  name: string;
  label: string;
  /** Null when the wallet already owned the name. */
  registerTx: Hex | null;
  /** Null when addr(60) already pointed at the wallet. */
  recordTx: Hex | null;
}

/**
 * Mint <label>.<parent> for a wallet: the wallet owns the token (with the
 * same roles a .eth registrant gets) and addr(60) points at it. The owner key
 * pays; the participant signs nothing on Sepolia and needs no Sepolia ETH.
 * Idempotent for the same wallet; a label owned by another wallet throws.
 */
export async function mintParticipantName(
  deps: WriteDeps,
  input: { label: string; wallet: Address },
): Promise<MintedName> {
  const { parentName } = deps.namespace;
  const name = subname(input.label, parentName);
  const registered = await ensureSubname(deps, {
    label: input.label,
    owner: input.wallet,
    roleBitmap: PARTICIPANT_NAME_ROLES,
  });
  if (registered.owner.toLowerCase() !== input.wallet.toLowerCase()) {
    throw new Error(`${name} is owned by another wallet`);
  }
  const current = await deps.client
    .getEnsAddress({ name, universalResolverAddress: ENS_SEPOLIA.universalResolver })
    .catch(() => null);
  let recordTx: Hex | null = null;
  if (current === null || current.toLowerCase() !== input.wallet.toLowerCase()) {
    recordTx = await setAddressRecord(deps, {
      name,
      coinType: ETH_COIN_TYPE,
      address: input.wallet,
    });
  }
  return {
    name,
    label: input.label,
    registerTx: registered.status === "registered" ? registered.txHash : null,
    recordTx,
  };
}
