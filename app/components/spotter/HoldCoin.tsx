"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
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
import { Button } from "@/components/ui";

// The hold button (docs/DESIGN.md, "Hold to stake"). Putting money on yourself
// is a press and hold on the moon-faced button: a gold ring fills around the
// USDC mark and a gold tint fills the face left to right over 1.2s, then the
// stake is committed. Letting go early cancels. Nobody is locked out of it:
// Enter or Space commits from the keyboard, and "Tap to confirm instead" opens
// an inline confirm that commits in one more tap. The fill tracks the player's
// own press, so it stays under reduced motion. Timing and cancel rules live in
// hold-commit.ts (node-tested).
//
// HoldCoin commits once per mount. If the stake then fails, the parent shows
// the error and remounts it (change its `key`) to let the player try again.

export interface HoldCoinProps {
  /** Fires exactly once, when the hold completes or a direct commit lands. */
  onCommit: () => void;
  /** The button's words and its accessible name, e.g. "Hold to stake 1.00 USDC". */
  label: string;
  /** The small line on the button while it can be held. */
  hint?: string;
  /** The one-tap alternative's text. */
  tapLabel?: string;
  /** The inline confirm's question, e.g. "Stake 1.00 USDC on Sleep 7 hours?" */
  confirmPrompt?: ReactNode;
  /** The inline confirm's button, e.g. "Stake 1.00 USDC". */
  confirmLabel?: string;
  /** Shown in place of the hint once committed. */
  committedHint?: string;
  disabled?: boolean;
  /** Why it is disabled, shown on the button. Required when disabled. */
  disabledReason?: string;
  durationMs?: number;
  /** Retired: the stake figure used to sit on a coin. The label names it now. */
  face?: ReactNode;
  className?: string;
}

function UsdcGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 4.6v10.8M12.9 7.2c-.4-1-1.5-1.6-2.9-1.6-1.6 0-2.8.9-2.8 2.2 0 2.9 5.9 1.4 5.9 4.3 0 1.3-1.3 2.3-3 2.3-1.4 0-2.6-.7-3-1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function HoldCoin({
  onCommit,
  label,
  hint = "About a second. Let go to cancel.",
  tapLabel = "Tap to confirm instead",
  confirmPrompt,
  confirmLabel = "Confirm",
  committedHint = "Sending your stake. Approve it in your wallet if it asks.",
  disabled = false,
  disabledReason,
  durationMs = HOLD_MS,
  className = "",
}: HoldCoinProps) {
  const [hold, setHold] = useState<HoldState>(INITIAL_HOLD);
  const [confirming, setConfirming] = useState(false);
  const holdRef = useRef<HoldState>(INITIAL_HOLD);
  const onCommitRef = useRef(onCommit);
  const hintId = useId();
  const confirmId = useId();

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

  // Drive the fill from animation frames only while a hold is live.
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
  const holding = hold.phase === "holding";
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

  const fill = { "--p": hold.progress } as CSSProperties;
  // Waiting (balance check, wallet, in flight) drops to the quiet fill so it
  // reads as "not now", never as a broken moon.
  const waiting = disabled && !committed;
  const face = waiting
    ? "bg-fill-quiet text-muted shadow-[inset_0_0_0_1px_var(--border)]"
    : "bg-[linear-gradient(180deg,var(--accent-top)_0%,var(--accent)_55%,var(--accent-bottom)_100%)] text-accent-foreground shadow-moon";

  return (
    <div className={`w-full ${className}`}>
      <button
        type="button"
        aria-describedby={hintId}
        aria-disabled={inert || undefined}
        onPointerDown={onPointerDown}
        onPointerUp={onRelease}
        onPointerCancel={onRelease}
        onLostPointerCapture={onRelease}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        style={{ ...fill, WebkitTouchCallout: "none" }}
        className={`relative flex h-[60px] w-full touch-none select-none items-center gap-3.5 overflow-hidden rounded-2xl pl-2.5 pr-[18px] text-left transition-transform duration-[90ms] ease-out [-webkit-tap-highlight-color:transparent] before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[calc(var(--p)*100%)] before:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--gold)_45%,transparent))] before:content-[''] ${face} ${
          holding ? "scale-[0.985]" : ""
        } ${inert ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span
          aria-hidden="true"
          className={`relative grid size-10 flex-none place-items-center rounded-full ${
            waiting ? "bg-surface-raised text-haze" : "bg-ink text-moonlight"
          }`}
        >
          <span className="absolute -inset-1 rounded-full bg-[conic-gradient(var(--gold)_calc(var(--p)*360deg),color-mix(in_srgb,var(--ink)_14%,transparent)_0)] [mask:radial-gradient(closest-side,transparent_84%,#000_87%)]" />
          <UsdcGlyph />
        </span>
        <span className="relative grid gap-[3px]">
          <span className="num text-[1.0625rem] font-bold leading-[1.1]">{label}</span>
          <span
            aria-hidden="true"
            className={`text-[0.8125rem] font-semibold leading-tight ${waiting ? "text-haze" : "text-ink/65"}`}
          >
            {status}
          </span>
        </span>
      </button>

      <p id={hintId} aria-live="polite" className="sr-only">
        {status}
      </p>

      {!inert ? (
        <div className="mt-1">
          <Button
            variant="tertiary"
            size="sm"
            aria-controls={confirmId}
            aria-expanded={confirming}
            onClick={() => setConfirming((open) => !open)}
          >
            {tapLabel}
          </Button>
          {confirming ? (
            <div
              id={confirmId}
              className="mt-2.5 rounded-control bg-surface-raised p-3.5 shadow-[inset_0_0_0_1px_var(--border)]"
            >
              {confirmPrompt !== undefined ? (
                <p className="num mb-3 text-[0.9375rem]">{confirmPrompt}</p>
              ) : null}
              <div className="flex flex-wrap gap-2.5">
                <Button size="sm" onClick={() => dispatch({ type: "commit" })}>
                  {confirmLabel}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
                  Not now
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
