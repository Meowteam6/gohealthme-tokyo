"use client";

// The outcome of a WHOOP connect, shown on the page the connect started from.
//
// WHOOP's OAuth takes over the tab and comes back through /api/whoop/callback
// with ?whoop=<outcome> on the page the player left (character creation or a
// pool). The round trip reloads the tab, so without this a decline or a failure
// came back to a screen that looked exactly as it did before, with nothing
// said. The dashboard has its own copy of this note, styled to that page.

import { useEffect, useState } from "react";
import { whoopReturnMessage } from "@/lib/wearable-connect";

/**
 * Read ?whoop= once, remove it from the URL, and say what happened.
 * "Connected" shows only once the live sensor read agrees (`whoopConnected`),
 * so a stale parameter can never vouch for whichever wallet is signed in now.
 */
export default function WhoopReturnNote({
  whoopConnected,
}: {
  whoopConnected: boolean;
}) {
  const [note, setNote] = useState<ReturnType<typeof whoopReturnMessage>>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get("whoop");
    if (status === null) return;
    // Reading the URL once on mount; the parameter is consumed in the same
    // tick, so there is no cascade. A lazy initializer would run during the
    // server render, where there is no window.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNote(whoopReturnMessage(status));
    url.searchParams.delete("whoop");
    window.history.replaceState(null, "", url.toString());
  }, []);

  if (note === null) return null;
  if (note.tone === "ok" && !whoopConnected) return null;
  return (
    <p
      role={note.tone === "error" ? "alert" : "status"}
      className={`rounded-lg border-2 p-4 text-sm ${
        note.tone === "error"
          ? "border-danger/40 bg-danger/5"
          : "border-accent/40 bg-accent/5"
      }`}
    >
      {note.message}
    </p>
  );
}
