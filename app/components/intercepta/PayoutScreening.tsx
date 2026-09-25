"use client";

// Lane contract (docs/LANES.md): one line inside The Verdict showing the payout screening
// result from a live Intercepta call. The intercepta lane replaces this file wholesale.

export type ScreeningStatus =
  | "pending"
  | "clear"
  | "blocked"
  | "unavailable"
  | "unconfigured";

export interface PayoutScreeningProps {
  status: ScreeningStatus;
  reason?: string;
}

export default function PayoutScreening({ status, reason }: PayoutScreeningProps) {
  return (
    <div data-lane="intercepta" data-stub="true">
      Payout screening: {status}
      {reason ? ` (${reason})` : ""}
    </div>
  );
}
