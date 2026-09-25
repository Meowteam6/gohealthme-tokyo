// Plain-English reading of IDKit's error codes.
//
// The codes are the string values of IDKitErrorCodes in @worldcoin/idkit-core
// 4.3.0 (read from the package's own index.d.ts). They are mirrored here as
// strings rather than imported so this module stays free of the SDK's WASM
// bundle and can be unit-tested under node; the widget host passes the enum
// value through, and an enum value IS its string.
//
// Every entry answers two questions the card needs: what to say, and
// whether "Try again" is worth offering. A cancel is a choice, not a failure,
// and reads as one.

export interface IdkitErrorView {
  /** Short title for the card. */
  title: string;
  /** One or two sentences, in the product's voice. */
  detail: string;
  /** Whether the same attempt is worth retrying as-is. */
  retryable: boolean;
  /** True for the codes that mean the person closed or refused the check. */
  cancelled: boolean;
}

const CANCELLED: IdkitErrorView = {
  title: "You closed the check.",
  detail:
    "Nothing happened and nothing was staked. Verify whenever you're ready.",
  retryable: true,
  cancelled: true,
};

const VIEWS: Record<string, IdkitErrorView> = {
  user_rejected: CANCELLED,
  cancelled: CANCELLED,
  verification_rejected: {
    title: "World App declined the request.",
    detail: "The verification was refused in World App. You can try again.",
    retryable: true,
    cancelled: true,
  },
  max_verifications_reached: {
    title: "This World ID has already been used here.",
    detail:
      "One human, one entry: this identity has already proven itself for GoHealthMe. If that was you on another wallet, sign in with that wallet.",
    retryable: false,
    cancelled: false,
  },
  nullifier_replayed: {
    title: "That proof was already used.",
    detail: "Start the check again to get a fresh one.",
    retryable: true,
    cancelled: false,
  },
  credential_unavailable: {
    title: "World App had no World ID to share.",
    detail:
      "Open World App, finish setting up your World ID (a quick selfie check is enough), then try again. On staging, pick an identity in the simulator.",
    retryable: true,
    cancelled: false,
  },
  world_id_4_not_available: {
    title: "Your World App needs an update.",
    detail: "Update World App from your app store, then try again.",
    retryable: true,
    cancelled: false,
  },
  world_id_3_not_available: {
    title: "Your World App needs an update.",
    detail: "Update World App from your app store, then try again.",
    retryable: true,
    cancelled: false,
  },
  timeout: {
    title: "The check timed out.",
    detail: "Venue Wi-Fi does that. Try again without reloading the page.",
    retryable: true,
    cancelled: false,
  },
  connection_failed: {
    title: "Could not reach World.",
    detail: "Check your connection and try again.",
    retryable: true,
    cancelled: false,
  },
  rp_signature_expired: {
    title: "That request expired.",
    detail: "The QR is only good for five minutes. Try again for a fresh one.",
    retryable: true,
    cancelled: false,
  },
  timestamp_too_old: {
    title: "That request expired.",
    detail: "Try again for a fresh one.",
    retryable: true,
    cancelled: false,
  },
  invalid_rp_signature: {
    title: "GoHealthMe's World setup is wrong.",
    detail:
      "The request was not signed with the key World expects. This is on us, not you; tell Andre.",
    retryable: false,
    cancelled: false,
  },
  unknown_rp: {
    title: "GoHealthMe's World setup is wrong.",
    detail: "World does not recognise this app's relying-party id. Tell Andre.",
    retryable: false,
    cancelled: false,
  },
  inactive_rp: {
    title: "GoHealthMe's World setup is wrong.",
    detail: "This app's relying party is inactive in the Developer Portal. Tell Andre.",
    retryable: false,
    cancelled: false,
  },
  malformed_request: {
    title: "GoHealthMe sent World a request it could not read.",
    detail: "This is on us, not you. Tell Andre.",
    retryable: false,
    cancelled: false,
  },
  failed_by_host_app: {
    title: "Could not verify.",
    detail: "GoHealthMe refused the proof. The reason is above; you can try again.",
    retryable: true,
    cancelled: false,
  },
};

const GENERIC: IdkitErrorView = {
  title: "Could not verify.",
  detail: "Something went wrong in the World check. Try again.",
  retryable: true,
  cancelled: false,
};

export function idkitErrorView(code: string | null | undefined): IdkitErrorView {
  if (typeof code !== "string") return GENERIC;
  return VIEWS[code] ?? { ...GENERIC, detail: `${GENERIC.detail} (${code})` };
}
