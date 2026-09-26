"use client";

// A run's lock, with its fix, shown before any stake. The same panel on the
// lobby row, the pool page and the challenge link, fed by lib/game/lobby.ts,
// so the three surfaces can never word the same limit differently. SPOTTER's
// detective pose sits inline with the reason (docs/DESIGN.md, locked run row).

import Link from "next/link";
import { useState } from "react";
import { lockCopy, type RunLock } from "@/lib/game/lobby";
import Spotter from "@/components/spotter/Spotter";
import { buttonClasses } from "@/components/ui";

export default function LockPanel({
  lock,
  returnTo,
  onCheckSensor,
  onRetry,
  compact = false,
}: {
  lock: RunLock;
  /** Where the fix should bring the player back to. */
  returnTo: string;
  /** Runs the one-tap sensor check. Absent where no check can run. */
  onCheckSensor?: () => Promise<boolean>;
  /** Re-reads a failed join check. Absent where no retry can run. */
  onRetry?: () => void;
  compact?: boolean;
}) {
  const copy = lockCopy(lock, returnTo);
  const [checking, setChecking] = useState(false);
  const [declined, setDeclined] = useState(false);

  // A lock is never a loss and never an error: a raised cream well, with
  // warning ink only on the hardware limit no tap can fix.
  const tone =
    copy.tone === "hardware"
      ? "border-warning/50 bg-surface-raised"
      : copy.tone === "wait"
        ? "border-edge bg-surface-raised"
        : "border-foreground/25 bg-surface-raised";

  const fix = copy.fix;
  return (
    <div className={`flex gap-3 rounded-[20px] border-2 ${tone} ${compact ? "p-3" : "p-4"}`}>
      <Spotter
        state="locked-row"
        size={compact ? "row" : "inline"}
        decorative
        className="shrink-0 self-start"
      />
      <div className="min-w-0 flex-1">
        <p className={`font-bold ${copy.tone === "hardware" ? "text-warning" : "text-foreground"}`}>
          {copy.title}
        </p>
        <p className="mt-1 text-sm text-foreground/85">{copy.detail}</p>
        {fix.kind === "link" ? (
          <Link href={fix.href} className={`mt-3 ${buttonClasses({ variant: "secondary" })}`}>
            {fix.label}
          </Link>
        ) : fix.kind === "retry" ? (
          onRetry !== undefined ? (
            <button type="button" onClick={onRetry} className={`mt-3 ${buttonClasses({ variant: "secondary" })}`}>
              {fix.label}
            </button>
          ) : (
            <p className="mt-2 text-xs text-muted">Reload the page to check again.</p>
          )
        ) : fix.kind === "check-sensor" && onCheckSensor !== undefined ? (
          <div className="mt-3">
            <button
              type="button"
              disabled={checking}
              onClick={() => {
                setChecking(true);
                setDeclined(false);
                void onCheckSensor()
                  .then((signed) => setDeclined(!signed))
                  .catch(() => setDeclined(true))
                  .finally(() => setChecking(false));
              }}
              className={`${buttonClasses()} disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none`}
            >
              {checking ? "Waiting for your signature" : fix.label}
            </button>
            <p className="mt-2 text-xs text-muted" aria-live="polite">
              {declined
                ? "No signature, so I still cannot see it. Tap again when you are ready."
                : "Signing costs nothing and sends no transaction."}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
