// Player-facing messages shared by the approval routes. Kept out of the route
// files because Next rejects non-handler exports from app/api route modules.

/** Returned when this deployment does not ask for a human confirmation. */
export const APPROVAL_NOT_ENABLED_MESSAGE =
  "SPOTTER does not ask for a World ID confirmation on this build, so there is nothing to confirm.";
