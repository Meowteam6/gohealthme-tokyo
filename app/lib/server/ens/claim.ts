// Claim <label>.<parent> for a wallet (server only).
//
// The route has already proven the caller controls the wallet with an EIP-191
// signature (requireAddressSignature); this module trusts its route the way
// social-profile.ts does. ENS is the source of truth for the name: the mint
// happens first, on Sepolia, from the owner key. The Supabase profile is a
// cache written afterwards when it is configured, and its absence changes
// nothing about the name.

import type { Address, Hex } from "viem";
import { checkEnsLabel, subname } from "@/lib/ens/names";
import { errorMessage } from "@/lib/server/http";
import { invalidateResolvedName } from "@/lib/server/ens/cache";
import {
  discoverNamespace,
  ensOwnerAccount,
  ensPublicClient,
  type EnsNamespace,
} from "@/lib/server/ens/client";
import { labelOwner, liveResolveDeps, type ResolveDeps } from "@/lib/server/ens/resolve";
import { liveWriteDeps, mintParticipantName, type WriteDeps } from "@/lib/server/ens/write";
import { LockUnavailableError } from "@/lib/server/store";
import {
  checkNameHuman,
  liveNameHumanDeps,
  rememberNameHuman,
  type NameHumanDeps,
} from "@/lib/server/ens/human-gate";
import { unlinkEnsName } from "@/lib/server/ens/link";

export type ClaimOutcome =
  | {
      ok: true;
      name: string;
      label: string;
      /** The registration tx, or the record tx when the name already existed, or null when nothing changed. */
      tx: Hex | null;
      alreadyOwned: boolean;
    }
  | { ok: false; status: number; reason: string };

export interface ClaimDeps {
  /** Whether an owner key exists, answered without any network call. */
  ownerConfigured: () => boolean;
  namespace: () => Promise<EnsNamespace | null>;
  ownerWrite: (namespace: EnsNamespace) => WriteDeps | null;
  resolve: ResolveDeps;
  /** Cache writer (Supabase profile). Absent or failing never fails the claim. */
  cacheProfile?: (address: Address, label: string) => Promise<void>;
  invalidate: (address: string) => Promise<void>;
  /** Prove-human gate (human-gate.ts). Off on the deployment means no gate. */
  human: NameHumanDeps;
  /** Drops a linked own ENS name, so the freshly claimed subname is shown. */
  clearLink: (address: string) => Promise<void>;
}

export function liveClaimDeps(): ClaimDeps {
  const client = ensPublicClient();
  return {
    ownerConfigured: () => ensOwnerAccount() !== null,
    namespace: () => discoverNamespace(client),
    ownerWrite: (namespace) => {
      const account = ensOwnerAccount();
      return account === null ? null : liveWriteDeps(account, namespace);
    },
    resolve: liveResolveDeps(),
    invalidate: invalidateResolvedName,
    human: liveNameHumanDeps(),
    clearLink: unlinkEnsName,
  };
}

export async function claimEnsName(
  input: { address: Address; rawLabel: string },
  deps: ClaimDeps = liveClaimDeps(),
): Promise<ClaimOutcome> {
  const check = checkEnsLabel(input.rawLabel);
  if (!check.ok) return { ok: false, status: 400, reason: check.reason };
  const label = check.label;

  // A name costs our Sepolia gas, so it needs a human before anything else.
  const human = await checkNameHuman(input.address, deps.human, label);
  if (!human.ok) return human;

  if (!deps.ownerConfigured()) {
    return {
      ok: false,
      status: 503,
      reason: "Name claiming is not configured on this deployment.",
    };
  }
  const namespace = await deps.namespace();
  if (namespace === null) {
    return {
      ok: false,
      status: 503,
      reason: "Names are not enabled on this deployment yet.",
    };
  }
  const writer = deps.ownerWrite(namespace);
  if (writer === null) {
    return {
      ok: false,
      status: 503,
      reason: "Name claiming is not configured on this deployment.",
    };
  }

  const owner = await labelOwner(label, deps.resolve);
  if (owner !== null && owner.toLowerCase() !== input.address.toLowerCase()) {
    return { ok: false, status: 409, reason: "That name is already taken." };
  }

  let minted;
  try {
    minted = await mintParticipantName(writer, { label, wallet: input.address });
  } catch (err) {
    if (err instanceof LockUnavailableError) {
      return {
        ok: false,
        status: 503,
        reason: "Another name is being minted right now. Try again in a few seconds.",
      };
    }
    console.error(`[ens/claim] mint of ${subname(label, namespace.parentName)} failed: ${errorMessage(err)}`);
    return {
      ok: false,
      status: 502,
      reason: "Sepolia did not confirm the name. Nothing was charged; try again.",
    };
  }

  try {
    await rememberNameHuman(human.humanKey, input.address, label);
  } catch (err) {
    console.error(`[ens/claim] human-name record write failed (name is minted): ${errorMessage(err)}`);
  }
  try {
    await deps.clearLink(input.address);
  } catch (err) {
    console.error(`[ens/claim] could not drop the linked name: ${errorMessage(err)}`);
  }
  await deps.invalidate(input.address);

  if (deps.cacheProfile !== undefined) {
    try {
      await deps.cacheProfile(input.address, label);
    } catch (err) {
      console.error(`[ens/claim] profile cache write failed (name is minted): ${errorMessage(err)}`);
    }
  }

  return {
    ok: true,
    name: minted.name,
    label,
    tx: minted.registerTx ?? minted.recordTx,
    alreadyOwned: minted.registerTx === null,
  };
}

/** How long the handle claim waits for the mint before answering the user. */
export const HANDLE_MINT_WAIT_MS = 8_000;

/**
 * Mint a subname for a handle claimed through the Supabase profile route.
 * Never throws and never blocks the handle claim for long: the transactions
 * are sent within a second or two, and if Sepolia has not confirmed them by
 * HANDLE_MINT_WAIT_MS the claim answers anyway. Resolution is the truth
 * either way. Handles that are not valid ENS labels (underscores) are logged
 * and skipped; the handle still works, it just has no subname.
 */
export async function mintHandleNameBestEffort(
  address: string,
  handle: string,
  deps: ClaimDeps = liveClaimDeps(),
  waitMs: number = HANDLE_MINT_WAIT_MS,
): Promise<void> {
  const check = checkEnsLabel(handle);
  if (!check.ok) {
    console.info(`[ens/claim] handle "${handle}" is not an ENS label (${check.reason}); no subname minted`);
    return;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return;
  if (!deps.ownerConfigured()) return;
  try {
    const human = await checkNameHuman(address, deps.human, check.label);
    if (!human.ok) {
      console.info(`[ens/claim] handle "${handle}" kept, no subname: ${human.reason}`);
      return;
    }
    const namespace = await deps.namespace();
    if (namespace === null) return;
    const writer = deps.ownerWrite(namespace);
    if (writer === null) return;
    const owner = await labelOwner(check.label, deps.resolve);
    if (owner !== null && owner.toLowerCase() !== address.toLowerCase()) {
      console.warn(`[ens/claim] ${check.label}.${namespace.parentName} is owned by another wallet; handle kept, no subname`);
      return;
    }
    const mint = mintParticipantName(writer, {
      label: check.label,
      wallet: address as Address,
    }).then(
      async (minted) => {
        await rememberNameHuman(human.humanKey, address, check.label).catch(() => undefined);
        console.log(`[ens/claim] minted ${minted.name} (register ${minted.registerTx ?? "existing"}, record ${minted.recordTx ?? "existing"})`);
      },
      (err: unknown) => {
        console.error(`[ens/claim] mint of ${check.label}.${namespace.parentName} failed: ${errorMessage(err)}`);
      },
    );
    await Promise.race([
      mint,
      new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
    ]);
    await deps.invalidate(address);
  } catch (err) {
    console.error(`[ens/claim] best-effort mint for ${handle} failed: ${errorMessage(err)}`);
  }
}
