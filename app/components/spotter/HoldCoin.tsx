"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  HOLD_MS,
  INITIAL_HOLD,
  holdReducer,
  isCommitKey,
  justCommitted,
  type HoldAction,
  type HoldState,
} from "./hold-commit";

// Putting money on yourself is a press and hold on the coin (docs/DESIGN.md):
// a coral ring fills over 1.2s and the stake is committed. No confirm popup.
// Nobody is locked out of it: Enter or Space on the coin commits, and a plain
// "Or tap here to confirm" button commits in one tap. The ring tracks the
// player's own press, so it stays under reduced motion; the pocketed pop does
// not. Timing and cancel rules live in hold-commit.ts (node-tested).
//
// HoldCoin commits once per mount. If the stake then fails, the parent shows
// the error and remounts it (change its `key`) to let the player try again.

export interface HoldCoinProps {
  /** Fires exactly once, when the hold completes or a direct commit lands. */
  onCommit: () => void;
  /** What the coin says, e.g. the stake "1.00". Money: keep it to the figure. */
  face: ReactNode;
  /** Accessible name of the coin, e.g. "Put 1.00 USDC on yourself". */
  label: string;
  /** Shown under the coin. */
  hint?: string;
  /** The one-tap alternative's text. */
  tapLabel?: string;
  /** Shown in place of the hint once committed. */
  committedHint?: string;
  disabled?: boolean;
  /** Why it is disabled, shown next to the coin. Required when disabled. */
  disabledReason?: string;
  durationMs?: number;
  className?: string;
}

export default function HoldCoin({
  onCommit,
  face,
  label,
  hint = "Press and hold the coin",
  tapLabel = "Or tap here to confirm",
  committedHint = "Pocketed. SPOTTER has your stake.",
  disabled = false,
  disabledReason,
  durationMs = HOLD_MS,
  className = "",
}: HoldCoinProps) {
  const [hold, setHold] = useState<HoldState>(INITIAL_HOLD);
  const holdRef = useRef<HoldState>(INITIAL_HOLD);
  const onCommitRef = useRef(onCommit);
  const hintId = useId();

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  const dispatch = useCallback((action: HoldAction) => {
    const prev = holdRef.current;
    const next = holdReducer(prev, action);
    if (next === prev) return;
    holdRef.current = next;
    setHold(next);
    if (justCommitted(prev, next)) onCommitRef.current();
  }, []);

  // Drive the ring from animation frames only while a hold is live.
  useEffect(() => {
    if (hold.phase !== "holding") return;
    let frame = 0;
    const step = () => {
      dispatch({ type: "tick", now: performance.now(), durationMs });
      if (holdRef.current.phase === "holding") frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [hold.phase, dispatch, durationMs]);

  const committed = hold.phase === "committed";
  const inert = disabled || committed;

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (inert || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dispatch({ type: "press", now: performance.now() });
  };
  const onRelease = () => dispatch({ type: "release" });
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!isCommitKey(e.key)) return;
    e.preventDefault();
    if (!inert) dispatch({ type: "commit" });
  };

  const status = committed
    ? committedHint
    : disabled
      ? (disabledReason ?? "Not available right now")
      : hint;

  return (
    <div className={`flex flex-col items-center text-center ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={hintId}
        aria-disabled={inert || undefined}
        onPointerDown={onPointerDown}
        onPointerUp={onRelease}
        onPointerCancel={onRelease}
        onLostPointerCapture={onRelease}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        className={`grid h-[8.25rem] w-[8.25rem] touch-none select-none place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-4 focus-visible:ring-offset-background ${
          inert ? "cursor-not-allowed" : "cursor-pointer"
        } ${disabled ? "opacity-60" : ""}`}
        style={{
          background: `conic-gradient(var(--accent) ${hold.progress}turn, var(--surface-raised) 0)`,
          WebkitTouchCallout: "none",
        }}
      >
        <span
          aria-hidden="true"
          className={`grid h-[6.5rem] w-[6.5rem] place-items-center rounded-full border-[3px] border-foreground bg-gold font-display text-[1.625rem] font-extrabold tabular-nums leading-none tracking-display text-foreground shadow-[inset_-8px_-6px_0_rgba(127,90,0,0.3)] ${
            committed ? "motion-safe:animate-stamp-in" : ""
          }`}
        >
          {face}
        </span>
      </button>

      <p
        id={hintId}
        aria-live="polite"
        className={`mt-3 text-sm ${disabled && !committed ? "font-bold text-warning" : "text-muted"}`}
      >
        {status}
      </p>

      {!inert ? (
        <button
          type="button"
          onClick={() => dispatch({ type: "commit" })}
          className="mt-1 inline-flex min-h-11 items-center px-3 text-sm font-bold text-accent-deep underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
        >
          {tapLabel}
        </button>
      ) : null}
    </div>
  );
}
