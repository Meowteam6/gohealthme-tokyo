// The Dynamic session half of every wallet-auth requester, in one place.
//
// getSessionToken is Dynamic's getAuthToken, read per request so a rotated
// token is picked up. proveSession is the registered session proof
// (lib/session-proof.ts): a wallet login's one explained signature.
// confirmPrompt is the sheet's in-page question, asked before any wallet
// opens for a request nobody confirmed with a Verify tap, so no surface can
// open the wallet cold. All three are null on a build with no Dynamic
// environment, where there is no client to ask and the plain signature is the
// only proof.
//
// useWalletAuth (every private read) and useEnsureGas (the gas drip before a
// first stake) both bind this, so neither can drift back to signing where the
// session token would have done, or to opening the wallet unexplained.

import { getAuthToken } from "@dynamic-labs/sdk-react-core";
import type { ConfirmPromptFn, ProveSessionFn, SessionTokenFn } from "@/lib/client-auth";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import { confirmRegisteredPrompt, proveRegisteredSession } from "@/lib/session-proof";

export interface DynamicSessionBinding {
  getSessionToken: SessionTokenFn | null;
  proveSession: ProveSessionFn | null;
  confirmPrompt?: ConfirmPromptFn | null;
}

export const dynamicSession: DynamicSessionBinding = DYNAMIC_CONFIGURED
  ? {
      getSessionToken: getAuthToken,
      proveSession: proveRegisteredSession,
      confirmPrompt: confirmRegisteredPrompt,
    }
  : { getSessionToken: null, proveSession: null, confirmPrompt: null };
