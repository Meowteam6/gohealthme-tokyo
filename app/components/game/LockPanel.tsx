"use client";

// A run's lock, with its fix, shown before any stake. The same panel on the
// lobby row, the pool page and the challenge link, fed by lib/game/lobby.ts,
// so the three surfaces can never word the same limit differently.

import Link from "next/link";
import { useState } from "react";
import { lockCopy, type RunLock } from "@/lib/game/lobby";
import { TAP_TARGET } from "@/components/ui";

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

  const tone =
    copy.tone === "hardware"
      ? "border-warning/60 bg-warning/5"
      : copy.tone === "wait"
        ? "border-edge bg-surface-raised"
        : "border-accent/50 bg-accent/5";

  const fix = copy.fix;
  return (
    <div className={`rounded-lg border-2 ${tone} ${compact ? "p-3" : "p-4"}`}>
      <p className={`font-semibold ${copy.tone === "hardware" ? "text-warning" : "text-foreground"}`}>
        {copy.title}
      </p>
      <p className="mt-1 text-sm text-foreground/80">{copy.detail}</p>
      {fix.kind === "link" ? (
        <Link
          href={fix.href}
          className={`mt-3 rounded-lg border-2 border-foreground bg-surface font-semibold text-foreground hover:bg-foreground hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${TAP_TARGET}`}
        >
          {fix.label}
        </Link>
      ) : fix.kind === "retry" ? (
        onRetry !== undefined ? (
          <button
            type="button"
            onClick={onRetry}
            className={`mt-3 rounded-lg border-2 border-foreground bg-surface font-semibold text-foreground hover:bg-foreground hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 ${TAP_TARGET}`}
          >
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
            className={`rounded-lg bg-accent font-semibold text-foreground hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${TAP_TARGET}`}
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
  );
}
