"use client";

// A run's lock, with its fix, shown before any stake. The same panel on the
// lobby row, the run page and the challenge link, fed by lib/game/lobby.ts,
// so the three surfaces can never word the same limit differently.
//
// Night Shift (docs/DESIGN.md): a raised well with a lock and the reason in
// plain words, then the one action that fixes it. No SPOTTER here: the screen
// around it already has its one pose. A lock is never a loss and never an
// error, so nothing in it is red; a hardware limit no tap can fix reads a
// shade brighter so it is not mistaken for a to-do.

import { useState } from "react";
import { lockCopy, type RunLock } from "@/lib/game/lobby";
import { Button, ButtonLink, Fine } from "@/components/ui";

function LockGlyph({ wait }: { wait: boolean }) {
  return wait ? (
    // A clock: this clears on its own.
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 flex-none text-muted">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.8V8l2.2 1.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 flex-none text-muted">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5.3a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

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
  /** A row's lock: smaller type and a small secondary fix. */
  compact?: boolean;
}) {
  const copy = lockCopy(lock, returnTo);
  const [checking, setChecking] = useState(false);
  const [declined, setDeclined] = useState(false);
  const fix = copy.fix;
  // The full panel's fix is the screen's one action, so it wears the moon;
  // on a row it is a small secondary so a board of locks stays quiet.
  const look = compact ? ({ variant: "secondary", size: "sm" } as const) : ({ variant: "primary" } as const);

  return (
    <div
      className={`flex gap-3 rounded-control bg-surface-raised shadow-[inset_0_0_0_1px_var(--border)] ${
        compact ? "px-3.5 py-3" : "p-4"
      }`}
    >
      <LockGlyph wait={copy.tone === "wait"} />
      <div className="min-w-0 flex-1">
        <p
          className={`m-0 font-semibold leading-snug ${compact ? "text-[0.9375rem]" : "text-base"} ${
            copy.tone === "hardware" ? "text-warning" : "text-foreground"
          }`}
        >
          {copy.title}
        </p>
        <p className={`m-0 mt-1 leading-[1.45] text-muted ${compact ? "text-[0.8125rem]" : "text-sm"}`}>
          {copy.detail}
        </p>
        {fix.kind === "link" ? (
          <ButtonLink href={fix.href} {...look} className="mt-3">
            {fix.label}
          </ButtonLink>
        ) : fix.kind === "retry" ? (
          onRetry !== undefined ? (
            <Button variant="secondary" size="sm" onClick={onRetry} className="mt-3">
              {fix.label}
            </Button>
          ) : (
            <Fine className="mt-2">Reload the page to check again.</Fine>
          )
        ) : fix.kind === "check-sensor" && onCheckSensor !== undefined ? (
          <div className="mt-3">
            <Button
              {...look}
              disabled={checking}
              onClick={() => {
                setChecking(true);
                setDeclined(false);
                void onCheckSensor()
                  .then((signed) => setDeclined(!signed))
                  .catch(() => setDeclined(true))
                  .finally(() => setChecking(false));
              }}
            >
              {checking ? "Waiting for your signature" : fix.label}
            </Button>
            <Fine className="mt-2">
              <span aria-live="polite">
                {declined
                  ? "No signature, so I still cannot see it. Tap again when you are ready."
                  : "Signing costs nothing and sends no transaction."}
              </span>
            </Fine>
          </div>
        ) : null}
      </div>
    </div>
  );
}
