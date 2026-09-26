"use client";

// Said only when the sign-in service has not answered for a while: a page
// that waits on the wallet SDK shows its loading card first, and after
// `afterMs` this notice explains the wait and offers a reload, so nobody sits
// on a skeleton that may never resolve (docs/DESIGN.md, States).

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { Notice } from "@/components/night/kit";

/** How long a page waits on the wallet SDK before it says so. */
export const SIGN_IN_SLOW_MS = 8000;

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
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setSlow(true), afterMs);
    return () => clearTimeout(t);
  }, [waiting, afterMs]);
  if (!waiting || !slow) return null;
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
