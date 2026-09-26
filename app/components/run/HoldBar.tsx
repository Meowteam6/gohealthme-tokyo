"use client";

import { useEffect, useState, type ReactNode } from "react";

// The phone hold bar (docs/DESIGN.md, "Phone hold bar"): the stake stays one
// thumb away, but only once the rules have been on screen and the card's own
// action has scrolled out of view, so the action is never shown twice and
// nobody stakes from a bar before reading what a miss costs. After joining it
// carries the "you're in" line and the challenge instead. Phones only.
//
// It watches elements by id rather than refs so the card and the bar can live
// in different components; `watchKey` re-arms the observers when the card's
// body changes (guest to hold, hold to joined).

export default function HoldBar({
  mode,
  termsId = "stake-terms",
  actionIds,
  watchKey,
  inline = false,
  children,
}: {
  /** "in" needs no terms first; "hold" and "guest" wait for them. */
  mode: "hold" | "guest" | "in";
  termsId?: string;
  /** The card's own action(s): the bar hides while any is on screen. */
  actionIds: readonly string[];
  watchKey: string;
  /** Draw the bar in the page flow, always shown: the state gallery only. */
  inline?: boolean;
  children: ReactNode;
}) {
  const [termsSeen, setTermsSeen] = useState(false);
  const [actionVisible, setActionVisible] = useState(true);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<Element, boolean>();
    const actions = actionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    const actionIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target, e.isIntersecting));
      setActionVisible([...seen.values()].some(Boolean));
    });
    actions.forEach((el) => actionIO.observe(el));

    const terms = document.getElementById(termsId);
    const termsIO = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting || e.boundingClientRect.top < 0)) {
        setTermsSeen(true);
      }
    });
    if (terms !== null) termsIO.observe(terms);
    return () => {
      actionIO.disconnect();
      termsIO.disconnect();
    };
    // actionIds is compared by watchKey: the caller changes the key when the
    // ids or the elements behind them change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, termsId]);

  const show = !actionVisible && (mode === "in" || termsSeen);

  if (inline) {
    return (
      <div className="rounded-card bg-[var(--header-scrolled)] px-gutter pb-2.5 pt-2.5 shadow-[inset_0_1px_0_var(--border)]">
        {children}
      </div>
    );
  }

  return (
    <>
      <div
        aria-hidden={!show}
        inert={!show}
        className={`fixed inset-x-0 bottom-0 z-[25] bg-[var(--header-scrolled)] px-gutter pb-[calc(10px+env(safe-area-inset-bottom))] pt-2.5 shadow-[inset_0_1px_0_var(--border),0_-12px_30px_-12px_var(--surface-deep)] backdrop-blur-[14px] transition-transform duration-[160ms] ease-out min-[960px]:hidden ${
          show ? "translate-y-0" : "translate-y-[110%]"
        }`}
      >
        {children}
      </div>
      {show ? <div aria-hidden="true" className="h-[132px] min-[960px]:hidden" /> : null}
    </>
  );
}
