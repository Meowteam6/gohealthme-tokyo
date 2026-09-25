// Whether another lane's feature is switched on for THIS deployment, and the
// small parsers for the lane APIs the game screens read (docs/LANES.md).
//
// The game screens mount the World, ENS and Intercepta components but never
// assume their routes exist: a build can ship without a lane merged, or with a
// lane merged and its env unset. Each lane route either answers (on), is
// missing or reports itself unconfigured (off), or fails (error). "Off" is a
// product state the flow says plainly and walks past; it is never an error and
// never a dead end.
//
// Pure and node-tested. The fetches live in the hooks that call these.

export type LaneAvailability = "on" | "off" | "error";

/**
 * Classify a lane route's HTTP status.
 *
 *   2xx          the lane answered.
 *   404          the route does not exist on this build (lane not merged).
 *   501 / 503    the lane is merged and fails closed on missing config, which
 *                LANES.md requires to be an honest state rather than a 500.
 *   anything else a real failure: the caller shows a retry, not "off".
 */
export function laneAvailabilityFromStatus(status: number): LaneAvailability {
  if (status >= 200 && status < 300) return "on";
  if (status === 404 || status === 501 || status === 503) return "off";
  return "error";
}

function recordOf(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

/** `GET /api/world/status` -> `{ human: "verified" | "unverified" }`. */
export function parseHumanStatus(
  payload: unknown,
): "verified" | "unverified" | null {
  const human = recordOf(payload).human;
  return human === "verified" || human === "unverified" ? human : null;
}

/** `GET /api/ens/resolve` -> `{ name: string | null }`. */
export function parseEnsName(payload: unknown): string | null {
  const name = recordOf(payload).name;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
}

export type ApprovalStatus =
  | "none"
  | "pending"
  | "approved"
  | "declined"
  | "expired"
  | "cancelled";

/** `GET /api/agent/approval/status` -> `{ status, mode, expiresAt? }`. */
export function parseApprovalStatus(payload: unknown): ApprovalStatus | null {
  const status = recordOf(payload).status;
  return status === "none" ||
    status === "pending" ||
    status === "approved" ||
    status === "declined" ||
    status === "expired" ||
    status === "cancelled"
    ? status
    : null;
}

export type ApprovalModeAnswer = "off" | "mock" | "world" | "misconfigured";

/** Whether SPOTTER asks for a World ID OK before it pays on this deployment.
 *  "off" when the step is not switched on; "misconfigured" when it is on and
 *  cannot run, so no win can pay; null when the answer is unusable. */
export function parseApprovalMode(payload: unknown): ApprovalModeAnswer | null {
  const mode = recordOf(payload).mode;
  return mode === "off" || mode === "mock" || mode === "world" || mode === "misconfigured"
    ? mode
    : null;
}

export type ScreeningStatus =
  | "pending"
  | "clear"
  | "blocked"
  | "unavailable"
  | "unconfigured";

/** `GET /api/screen/status` -> `{ status, reason? }`. Unknown values read as
 *  unavailable, never as clear: a screen we cannot read has not passed. */
export function parseScreening(payload: unknown): {
  status: ScreeningStatus;
  reason: string | null;
} {
  const record = recordOf(payload);
  const status = record.status;
  const known: ScreeningStatus[] = [
    "pending",
    "clear",
    "blocked",
    "unavailable",
    "unconfigured",
  ];
  const reason =
    typeof record.reason === "string" && record.reason !== ""
      ? record.reason
      : null;
  return {
    status: known.includes(status as ScreeningStatus)
      ? (status as ScreeningStatus)
      : "unavailable",
    reason,
  };
}
