"use client";

import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui";
import { StakeAction, StakeChecks } from "@/components/run/StakeCard";
import { lockCopy, type RunLock } from "@/lib/game/lobby";

// A run's lock inside the stake card (docs/DESIGN.md, "Stake card states",
// locked): the reason as the check that fails, then its fix as the card's one
// action, before anything is staked. The words come from lib/game/lobby.ts
// lockCopy, the same source the lobby row and the challenge link read, so the
// three surfaces can never word a limit differently. Signed out is the guest
// state and has its own action, so it never renders here.

export default function StakeLock({
  lock,
  returnTo,
  onCheckSensor,
  onRetry,
}: {
  lock: RunLock;
  /** Where the fix brings the player back to. */
  returnTo: string;
  /** The one-tap wearable check. Absent where no check can run. */
  onCheckSensor?: () => Promise<boolean>;
  /** Re-reads a failed join check. */
  onRetry?: () => void;
}) {
  const copy = lockCopy(lock, returnTo);
  const [checking, setChecking] = useState(false);
  const [declined, setDeclined] = useState(false);
  const fix = copy.fix;

  const row = (
    <StakeChecks
      items={[
        {
          key: "lock",
          glyph: "lock",
          children: (
            <>
              <b>{copy.title}.</b> {copy.detail}
            </>
          ),
        },
      ]}
    />
  );

  if (fix.kind === "link") {
    return (
      <>
        {row}
        <StakeAction id="stake-action" fine="Nothing is staked until this is sorted.">
          <ButtonLink href={fix.href} block>
            {fix.label}
          </ButtonLink>
        </StakeAction>
      </>
    );
  }

  if (fix.kind === "retry") {
    return (
      <>
        {row}
        <StakeAction id="stake-action" fine="Nothing is staked while a check is unanswered.">
          {onRetry !== undefined ? (
            <Button block onClick={onRetry}>
              {fix.label}
            </Button>
          ) : (
            <p className="m-0 text-sm text-muted">Reload the page to check again.</p>
          )}
        </StakeAction>
      </>
    );
  }

  if (fix.kind === "check-sensor" && onCheckSensor !== undefined) {
    return (
      <>
        {row}
        <StakeAction id="stake-action">
          <Button
            block
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
          <p className="m-0 mt-2 text-[0.8125rem] leading-[1.45] text-haze" aria-live="polite">
            {declined
              ? "No signature, so I still cannot see it. Tap again when you are ready."
              : "Signing costs nothing and sends no transaction."}
          </p>
        </StakeAction>
      </>
    );
  }

  // A wait: nothing the player can press fixes it, so the card says when it
  // clears instead of offering a button that does nothing.
  return (
    <>
      {row}
      <p className="m-0 mt-4 rounded-control bg-fill-quiet px-3.5 py-3 text-sm text-muted shadow-[inset_0_0_0_1px_var(--border)]">
        Nothing is staked. Open this challenge again once it clears and the hold is here.
      </p>
    </>
  );
}
