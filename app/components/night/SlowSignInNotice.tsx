"use client";

// Said only when the sign-in service has not answered for a while: a page
// that waits on the wallet SDK shows its loading card first, and after
// `afterMs` this notice explains the wait and offers a reload, so nobody sits
// on a skeleton that may never resolve (docs/DESIGN.md, States).

import { useEffect, useState, type ReactNode } from "react";
import { Button, Card } from "@/components/ui";
import { Notice } from "@/components/night/kit";

/** How long a page waits on the wallet SDK before it says so. */
export const SIGN_IN_SLOW_MS = 8000;

function useSlow(waiting: boolean, afterMs: number): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setSlow(true), afterMs);
    return () => clearTimeout(t);
  }, [waiting, afterMs]);
  return waiting && slow;
}

function SlowNotice({ className = "" }: { className?: string }) {
  return (
    <Notice
      tone="limit"
      title="Sign-in is taking longer than usual"
      role="status"
      live
      className={className}
      action={
        <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      }
    >
      The sign-in service has not answered yet. A reload usually fixes it; nothing is lost.
    </Notice>
  );
}

export default function SlowSignInNotice({
  waiting,
  afterMs = SIGN_IN_SLOW_MS,
  className = "",
}: {
  /** True while the wallet SDK has not reported ready. */
  waiting: boolean;
  afterMs?: number;
  className?: string;
}) {
  const slow = useSlow(waiting, afterMs);
  if (!slow) return null;
  return <SlowNotice className={className} />;
}

/**
 * A page's loading card while the wallet SDK has not reported ready: the
 * skeleton (`children`) first, and once `afterMs` passes the same card holds
 * the notice instead, so the page never shows a stuck skeleton card with a
 * second card under it. Busy only while the skeleton shows, so the notice is
 * announced.
 */
export function SignInLoadingCard({
  label,
  children,
  afterMs = SIGN_IN_SLOW_MS,
}: {
  /** Read to screen readers while loading, e.g. "Loading your runs". */
  label: string;
  children: ReactNode;
  afterMs?: number;
}) {
  const slow = useSlow(true, afterMs);
  if (slow) {
    // The card itself says it: no box inside a box.
    return (
      <Card role="status" aria-live="polite">
        <p className="m-0 text-[1.0625rem] font-semibold">Sign-in is taking longer than usual</p>
        <p className="m-0 mt-1 text-[0.9375rem] leading-[1.45] text-muted">
          The sign-in service has not answered yet. A reload usually fixes it; nothing is lost.
        </p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      </Card>
    );
  }
  return (
    <Card aria-busy="true">
      <p className="sr-only" role="status">
        {label}
      </p>
      {children}
    </Card>
  );
}
