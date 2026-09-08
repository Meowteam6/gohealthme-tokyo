// The provider registry's identity, declared ONCE for both sides of the wire.
//
// This existed in five places: the server's ProviderId union, and four
// hard-coded `"junction" | "whoop"` checks in the client connect module (the
// link-target parse, the option-row filter, the selected-provider parse, and
// the exported client type). A provider missing from any one of them was
// dropped SILENTLY - it simply vanished from the picker with nothing in the
// console and no error anywhere - which is precisely the kind of dead end that
// is a defect rather than a rough edge.
//
// Adding a provider is now one edit to this array. Everything that has to
// agree derives from it, and the exhaustive Record in lib/server/wearable
// stops compiling until the new provider is actually wired up.
//
// No imports, no I/O: safe in a client bundle and in a server module alike.

export const PROVIDER_IDS = ["junction", "whoop", "apple"] as const;

/** Which integration backs a wallet's health data. */
export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return (
    typeof value === "string" &&
    (PROVIDER_IDS as readonly string[]).includes(value)
  );
}
