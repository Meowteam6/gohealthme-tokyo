"use client";

// The join delight moment: SPOTTER cheers you into the pool. Built on the same
// pattern as PayoutMoment (a pop-in takeover that dismisses to a compact
// receipt) but deliberately quieter, because a join is not a payout.
//
// Honest-core (binding):
//   - NO gold. Gold is reserved strictly for money that actually moved; a join
//     moves none, so the whole moment is emerald + coral. The "Joined" stamp is
//     the emerald trust tone, never the gold money tone.
//   - The SPOTTER line is DRY/deadpan, never "loud" — loud is reserved for a
//     verified win. Joining proves nothing and pays nothing, and the copy says
//     exactly that.
//   - Reduced motion is respected the same way the payout moment is: the pop,
//     the float, and the confetti are all neutralized by the reduced-motion CSS
//     block in globals.css, and Confetti renders nothing under it.
//
// The takeover opens only for a fresh join (celebrate). A returning participant
// who was already in gets the calm receipt with no pop-in — the caller decides
// which by reading its own local join state, never the transaction logic.

import { useEffect, useRef, useState } from "react";
import { ArcTxLink, Stamp } from "@/components/ui";
import Confetti from "@/components/Confetti";
import { spotterSays } from "@/lib/spotter-says";

export default function JoinMoment({
  txHash,
  celebrate = true,
}: {
  txHash: string | null;
  /** Fresh join -> the takeover pops in. Returning/already-joined -> false, so
   *  only the calm receipt renders and no modal takes over the screen. */
  celebrate?: boolean;
}) {
  const [open, setOpen] = useState(celebrate);

  // SPOTTER's line is drawn per-session and is random, so it is picked on the
  // client only (in an effect, never a useState initializer) to keep server and
  // client markup in agreement. First paint carries the copy below; the picked
  // line replaces it a beat later.
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- picked post-mount on purpose; a useState initializer would hydrate-mismatch (server and client would draw different lines).
    setLine(spotterSays("join", "joined")?.text ?? null);
  }, []);

  const spotterLine = line ?? "Now go do the thing.";

  // --- Focus management for the takeover (a11y) ---------------------------
  // A modal dialog must trap focus while open, hand focus back on close, and
  // close on Escape. The dialog also carries aria-modal, and the receipt card
  // behind it is marked inert + aria-hidden, so neither Tab nor a screen reader
  // reaches the duplicated background content.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const goButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Remember what had focus so it can be restored when the takeover closes.
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // Move focus into the dialog, onto its primary action.
    goButtonRef.current?.focus({ preventScroll: true });
    return () => {
      restoreFocusRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  // Escape closes (same as the dismiss button); Tab is trapped within the
  // dialog so it cannot land on background content.
  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key !== "Tab") return;
    const root = dialogRef.current;
    if (root === null) return;
    const focusable = root.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !root.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !root.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  };

  // The record left behind once the takeover is dismissed — a warm little
  // membership receipt, SPOTTER still cheering. Emerald, never gold. While the
  // takeover is open this same card also renders behind it, so it is marked
  // inert + aria-hidden then (open === true) to keep Tab and screen readers off
  // the duplicate; when it is the standalone receipt (open === false) it is fully
  // live.
  const record = (
    <div
      inert={open}
      aria-hidden={open || undefined}
      className="flex items-center gap-4 rounded-2xl border border-edge bg-surface p-5 shadow-sm sm:gap-5 sm:p-6"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/spotter/spotter-cheer.webp"
        alt="SPOTTER the otter cheering"
        className="h-20 w-auto shrink-0 sm:h-24"
      />
      <div className="min-w-0">
        <Stamp tone="accent">Joined</Stamp>
        <p className="mt-2 text-base font-semibold text-foreground">
          You are in. One wallet, one entry.
        </p>
        <p className="text-sm text-muted">{spotterLine}</p>
        {txHash !== null ? (
          <p className="mt-2">
            <ArcTxLink txHash={txHash} label="See the public receipt" />
            <span className="mt-0.5 block text-xs text-muted">
              (anyone can check this — that&apos;s the point)
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );

  if (!open) return record;

  return (
    <>
      {record}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="You joined the pool"
        onKeyDown={onDialogKeyDown}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setOpen(false)}
          className="absolute inset-0 cursor-default bg-foreground/40 backdrop-blur-sm"
        />
        <div className="animate-payout-pop relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-edge bg-surface shadow-2xl">
          {/* the scene: SPOTTER cheers you on at the riverbank. Confetti is coral
              + emerald only (never gold) and rains once; both self-disable under
              reduced motion. */}
          <div className="relative aspect-video overflow-hidden bg-surface-raised">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/spotter/backdrop.webp"
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover object-bottom"
            />
            <Confetti />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/spotter/spotter-cheer.webp"
              alt="SPOTTER the otter cheering you on"
              className="otter-float absolute bottom-0 left-1/2 h-40 w-auto -translate-x-1/2 drop-shadow-xl"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface to-transparent"
            />
          </div>

          <div className="px-6 pb-6 pt-3 text-center">
            <div className="flex justify-center">
              <Stamp tone="accent">Joined</Stamp>
            </div>
            <p className="mt-4 text-lg font-semibold text-foreground">
              You are in.
            </p>
            <p className="mt-1 text-sm text-muted">One wallet, one entry.</p>
            <p className="mt-2 text-sm text-muted">{spotterLine}</p>
            {txHash !== null ? (
              <p className="mt-4">
                <ArcTxLink txHash={txHash} label="See the public receipt" />
                <span className="mt-0.5 block text-xs text-muted">
                  (anyone can check this — that&apos;s the point)
                </span>
              </p>
            ) : null}
            <button
              ref={goButtonRef}
              type="button"
              onClick={() => setOpen(false)}
              className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-accent px-6 py-2 text-sm font-semibold text-foreground hover:bg-accent-hover"
            >
              Let&apos;s go
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
