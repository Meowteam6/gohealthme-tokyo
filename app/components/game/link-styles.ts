// Links that act as buttons, in the Riverbank button language (components/ui.tsx
// Button). A <Link> cannot be a <button>, so the classes live here once for the
// lobby, the run and My runs instead of being re-typed per call site.

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The pressable coral toy: ink text, a 4px deeper-coral bottom shadow. */
export const PRIMARY_LINK = `inline-flex min-h-12 items-center justify-center gap-2 rounded-[18px] bg-accent px-5 py-3 text-base font-bold text-foreground shadow-[var(--shadow-pop)] transition-transform hover:bg-accent-hover active:translate-y-1 active:shadow-none motion-reduce:transition-none ${FOCUS}`;

/** The ink-outlined second action. */
export const GHOST_LINK = `inline-flex min-h-12 items-center justify-center gap-2 rounded-[18px] border-2 border-foreground bg-transparent px-5 py-3 text-base font-bold text-foreground hover:bg-surface-raised ${FOCUS}`;

/** An inline text link in deep pond, still a 44px target. */
export const TEXT_LINK = `inline-flex min-h-11 items-center font-bold text-accent-deep underline underline-offset-2 hover:text-foreground ${FOCUS}`;
