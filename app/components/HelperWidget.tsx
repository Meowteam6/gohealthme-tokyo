"use client";

// The first-run helper. One floating bubble, bottom-right, app-wide. Three
// tabs: Coach (scripted, state-aware, no LLM), Ask (guarded Gemini), Feedback
// (Supabase). Dismissible, mobile-first, never a trapping modal.
//
// It never opens by itself. An auto-opened panel sat on top of the landing
// hero and the sign-in call to action for every first-time visitor; the
// bubble's gold dot is the nudge, and the player opens it when they want it.
//
// The coach reads the SAME character state as the gate (useCharacter: sign
// in, prove human, pick a name, pair a sensor) plus the onboarding skips, so
// it can never tell a player to do a step character creation does not have.
// Sign-in stays email-first: the coach renders SignInPanel for that step
// instead of opening the raw wallet modal. Every other step hands off to the
// /character flow that owns it.
//
// The coach's decision lives in lib/help/coach.ts (pure, tested); this file
// only wires the returned step to a real handler and paints it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Address } from "viem";
import { useCharacter } from "@/lib/game/useCharacter";
import { useOnboarding } from "@/lib/game/onboarding-store";
import {
  coachChecklist,
  coachCopy,
  resolveCoachStep,
  type ChecklistRow,
  type CoachStep,
} from "@/lib/help/coach";
import type { HumanMode } from "@/lib/game/character";
import {
  ASK_PER_SESSION_CAP,
  MAX_QUESTION_CHARS,
} from "@/lib/server/help/knowledge";
import SignInPanel from "@/components/SignInPanel";

type Tab = "coach" | "ask" | "feedback";
type AskMessage = { role: "you" | "spotter"; text: string };
type Rating = "easy" | "confusing";

const SESSION_KEY = "ghm-helper-session";

/** A stable per-browser id for anonymous rate-limiting on Ask and Feedback. */
function ensureSessionId(): string {
  if (typeof window === "undefined") return "anon";
  try {
    const existing = window.localStorage.getItem(SESSION_KEY);
    if (existing !== null && existing !== "") return existing;
    const fresh = globalThis.crypto.randomUUID();
    window.localStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return "anon";
  }
}

// ------------------------------------------------------------------- glyphs

function CompassGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 12 15.5 8.5 13 12.5 12 12ZM12 12 8.5 15.5 11 11.5 12 12Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="var(--accent-deep)" />
      <path
        d="M6 10.5 9 13.5 14 7.5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RingIcon({ gold }: { gold?: boolean }) {
  const color = gold ? "var(--gold)" : "var(--accent)";
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function DotIcon({ gold }: { gold?: boolean }) {
  const color = gold ? "var(--gold)" : "var(--muted)";
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="10" cy="10" r="3" fill={color} opacity={gold ? 0.7 : 0.5} />
    </svg>
  );
}

// ------------------------------------------------------------------- checklist

function Checklist({ step, rows }: { step: CoachStep; rows: ChecklistRow[] }) {
  return (
    <ul className="mt-4 space-y-2">
      {rows.map((row, i) => {
        const done = i < step.index;
        const current = i === step.index;
        return (
          <li
            key={row.id}
            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
              current ? "bg-accent/20" : ""
            }`}
          >
            <span className="shrink-0">
              {done ? (
                <CheckIcon />
              ) : current ? (
                <RingIcon gold={row.gold} />
              ) : (
                <DotIcon gold={row.gold} />
              )}
            </span>
            <span
              className={`${
                row.gold
                  ? "text-gold-deep"
                  : current
                    ? "font-semibold text-foreground"
                    : done
                      ? "text-muted"
                      : "text-muted/70"
              }`}
            >
              {row.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------- coach tab

function CoachTab({
  step,
  humanMode,
  onPrimary,
  onSecondary,
  onRetry,
}: {
  step: CoachStep;
  humanMode: HumanMode;
  onPrimary: () => void;
  onSecondary: () => void;
  onRetry: () => void;
}) {
  const copy = coachCopy(step.id, humanMode);
  const rows = coachChecklist(humanMode);

  // A failed read or an allowlist wait replaces the step's pitch with what is
  // actually going on, and the one action that can move it.
  const blocked = step.error ?? step.waiting;
  const headline =
    step.error !== null
      ? "Could not check this step"
      : step.waiting !== null
        ? "You are on the list"
        : copy.headline;
  const body = blocked ?? copy.body;

  return (
    <div aria-live="polite">
      <p className="text-sm font-semibold text-accent">{headline}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>

      {blocked !== null ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={onRetry}
            className="min-h-11 rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-background hover:bg-accent"
          >
            {step.error !== null ? "Try again" : "Check my spot"}
          </button>
        </div>
      ) : step.id === "signIn" ? (
        // Email-first in the coach too: render the SignInPanel in place of a
        // bare login() button so the provisioned embedded wallet stays the
        // default here and the raw wallet modal never opens.
        <div className="mt-3">
          <SignInPanel />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onPrimary}
            disabled={step.loading}
            className="min-h-11 rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-background hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copy.primary}
          </button>
          {copy.secondary !== undefined ? (
            <button
              type="button"
              onClick={onSecondary}
              className="min-h-11 rounded-lg border border-edge px-4 py-2 text-sm font-medium text-muted hover:text-foreground"
            >
              {copy.secondary}
            </button>
          ) : null}
        </div>
      )}

      {step.loading ? (
        <p className="mt-2 animate-pulse text-xs text-muted motion-reduce:animate-none">
          Checking where you are...
        </p>
      ) : null}

      <Checklist step={step} rows={rows} />
    </div>
  );
}

// ------------------------------------------------------------------- ask tab

function AskTab({ address }: { address: Address | null }) {
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, asking]);

  const submit = useCallback(async () => {
    const question = input.trim();
    if (question === "" || asking) return;
    setError(null);
    setMessages((m) => [...m, { role: "you", text: question }]);
    setInput("");
    setAsking(true);
    try {
      const res = await fetch("/api/help/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          session: ensureSessionId(),
          ...(address !== null ? { address } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        answer?: string;
        remaining?: number;
        error?: string;
      };
      if (res.status === 429) {
        setError(data.error ?? "You have used your questions for now.");
      } else if (!res.ok || typeof data.answer !== "string") {
        setError(data.error ?? "Something went wrong. Try again in a moment.");
      } else {
        setMessages((m) => [...m, { role: "spotter", text: data.answer as string }]);
        if (typeof data.remaining === "number") setRemaining(data.remaining);
      }
    } catch {
      setError("Could not reach the helper. Check your connection.");
    } finally {
      setAsking(false);
    }
  }, [input, asking, address]);

  const left = remaining ?? ASK_PER_SESSION_CAP;

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="min-h-32 flex-1 space-y-3 overflow-y-auto pr-1"
      >
        {messages.length === 0 ? (
          <p className="text-sm leading-relaxed text-muted">
            Ask anything about using GoHealthMe - signing in, test USDC, pools,
            proof, getting paid, or how your data stays private. I only cover
            using the app.
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={m.role === "you" ? "text-right" : "text-left"}
            >
              <span
                className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                  m.role === "you"
                    ? "bg-accent/10 text-foreground"
                    : "bg-surface-raised text-muted"
                }`}
              >
                {m.text}
              </span>
            </div>
          ))
        )}
        {asking ? (
          <p className="animate-pulse text-sm text-muted">thinking...</p>
        ) : null}
      </div>

      {error !== null ? (
        <p className="mt-2 text-xs text-warning">{error}</p>
      ) : null}

      <div className="mt-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          maxLength={MAX_QUESTION_CHARS}
          rows={2}
          placeholder="How do I get paid?"
          className="w-full resize-none rounded-lg border border-edge bg-surface-raised px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-accent/60 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-muted">{left} of {ASK_PER_SESSION_CAP} left</span>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={asking || input.trim() === ""}
            className="min-h-11 rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-background hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- feedback tab

function FeedbackTab({
  address,
  pathname,
}: {
  address: Address | null;
  pathname: string;
}) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (rating === null && message.trim() === "") {
      setError("Add a rating or a note.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(rating !== null ? { rating } : {}),
          ...(message.trim() !== "" ? { message: message.trim() } : {}),
          ...(address !== null ? { address } : {}),
          page: pathname,
          session: ensureSessionId(),
        }),
      });
      if (res.ok) {
        setDone(true);
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not send that. Try again in a moment.");
      }
    } catch {
      setError("Could not reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }, [rating, message, address, pathname]);

  if (done) {
    return (
      <div className="rounded-xl border border-accent/40 bg-surface-raised p-4">
        <p className="text-sm font-semibold text-accent">Thanks - noted</p>
        <p className="mt-1 text-sm text-muted">
          Your note went straight to the founders. It helps more than you know.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm leading-relaxed text-muted">
        How was getting started?
      </p>
      <div className="mt-3 flex gap-2">
        {(["easy", "confusing"] as Rating[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRating(r)}
            className={`min-h-11 flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize ${
              rating === r
                ? "border-accent/60 bg-accent/10 text-accent-strong"
                : "border-edge bg-surface-raised text-muted hover:text-foreground"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted">
        What tripped you up?
      </label>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder="Optional - anything that was unclear"
        className="mt-1 w-full resize-none rounded-lg border border-edge bg-surface-raised px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-accent/60 focus:outline-none"
      />

      {error !== null ? (
        <p className="mt-2 text-xs text-warning">{error}</p>
      ) : null}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="mt-3 min-h-11 w-full rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-background hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Sending..." : "Send feedback"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- the widget

const TABS: { id: Tab; label: string }[] = [
  { id: "coach", label: "Coach" },
  { id: "ask", label: "Ask" },
  { id: "feedback", label: "Feedback" },
];

export default function HelperWidget() {
  const router = useRouter();
  const pathname = usePathname();
  const view = useCharacter();
  const onboarding = useOnboarding(view.address);
  const address: Address | null = view.address;

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("coach");

  const step = useMemo(
    () =>
      resolveCoachStep({
        steps: view.steps,
        humanMode: view.humanMode,
        skipped: onboarding.skipped,
      }),
    [view.steps, view.humanMode, onboarding.skipped],
  );

  // Every character step is owned by /character; send the player there and
  // bring them back to where they were (the lobby when they came from home).
  const toCharacter = useCallback(() => {
    const back = pathname === "/" || pathname === "/character" ? "/pools" : pathname;
    setOpen(false);
    router.push(`/character?next=${encodeURIComponent(back)}`);
  }, [pathname, router]);

  const onPrimary = useCallback(() => {
    switch (step.id) {
      case "signIn":
        // Sign-in is handled inline by the SignInPanel the coach renders for
        // this step, not by this button - kept in the union for exhaustiveness.
        break;
      case "proveHuman":
      case "pickName":
      case "pairSensor":
        toCharacter();
        break;
      case "enterRun":
        setOpen(false);
        router.push("/pools");
        break;
    }
  }, [step.id, toCharacter, router]);

  const { skip } = onboarding;
  const onSecondary = useCallback(() => {
    switch (step.id) {
      case "pickName":
        // The same skip character creation records, so the two agree.
        skip("name");
        break;
      case "pairSensor":
        setOpen(false);
        router.push("/pools");
        break;
      case "enterRun":
        setOpen(false);
        router.push("/challenge/new");
        break;
      default:
        break;
    }
  }, [step.id, skip, router]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const pending = step.id !== "enterRun";

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open the GoHealthMe helper"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-accent-strong text-background shadow-lg shadow-black/40 hover:bg-accent"
      >
        <CompassGlyph />
        {pending ? (
          <span className="absolute right-1 top-1 h-3 w-3 rounded-full border-2 border-background bg-gold" />
        ) : null}
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="GoHealthMe helper"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
      className="fixed bottom-4 right-4 z-50 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-[360px] flex-col rounded-2xl border border-edge bg-surface shadow-xl shadow-black/50"
    >
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <div className="flex items-center gap-2 text-accent">
          <CompassGlyph />
          <span className="text-sm font-semibold text-foreground">
            Getting started
          </span>
        </div>
        <button
          type="button"
          aria-label="Close the helper"
          onClick={close}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-lg leading-none text-muted hover:text-foreground"
        >
          &times;
        </button>
      </div>

      <div className="flex gap-1 px-3 pt-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`min-h-11 rounded-full px-3 text-xs font-semibold ${
              tab === t.id
                ? "bg-accent/10 text-accent-strong"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === "coach" ? (
          <CoachTab
            step={step}
            humanMode={view.humanMode}
            onPrimary={onPrimary}
            onSecondary={onSecondary}
            onRetry={view.refresh}
          />
        ) : tab === "ask" ? (
          <AskTab address={address} />
        ) : (
          <FeedbackTab address={address} pathname={pathname} />
        )}
      </div>
    </div>
  );
}
