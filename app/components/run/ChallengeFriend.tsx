"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, type ButtonVariant } from "@/components/ui";

// "Challenge a friend into this run": hands this public run's link to the
// phone's share sheet, or copies it where there is none. The link is the
// run page itself, which is public; a private challenge never renders this
// (its invite is a /c/<token> link only its creator holds).

const noop = () => () => {};

export default function ChallengeFriend({
  path,
  text,
  label = "Bring a friend into this challenge",
  variant = "primary",
  block = true,
  tabIndex,
}: {
  /** The run's path, e.g. "/pools/5". */
  path: string;
  /** The message that goes with the link. */
  text: string;
  label?: string;
  variant?: ButtonVariant;
  block?: boolean;
  tabIndex?: number;
}) {
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (note === null) return;
    const t = setTimeout(() => setNote(null), 3000);
    return () => clearTimeout(t);
  }, [note]);

  const url = origin === null ? null : `${origin}${path}`;

  const share = async () => {
    if (url === null) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "GoHealthMe", text, url });
        return;
      } catch (err) {
        // The player closed the sheet: nothing to say.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setNote("Link copied. Send it to your friend.");
    } catch {
      setNote(`Copying is blocked here. The link is ${url}`);
    }
  };

  return (
    <div>
      <Button
        variant={variant}
        block={block}
        disabled={url === null}
        onClick={() => void share()}
        tabIndex={tabIndex}
      >
        {label}
      </Button>
      <p aria-live="polite" className="m-0 mt-1.5 min-h-[1px] text-[0.8125rem] text-haze empty:mt-0">
        {note ?? ""}
      </p>
    </div>
  );
}
