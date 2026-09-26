// SPOTTER's caption box (docs/DESIGN.md): his name, then his one line, in a
// raised box. It replaced the Riverbank speech bubble. No tail, no handwriting
// face: he is the referee, and his line reads like one.

export default function SpotterCaption({
  line,
  live = false,
  label = "SPOTTER",
  className = "",
}: {
  line: string;
  /** Announce the line when it changes after an action. */
  live?: boolean;
  /** Who is speaking. Always SPOTTER in the product. */
  label?: string;
  className?: string;
}) {
  return (
    <p
      aria-live={live ? "polite" : undefined}
      className={`m-0 rounded-control bg-surface-raised px-3.5 py-3 text-[0.9375rem] font-medium leading-[1.45] text-foreground shadow-[inset_0_0_0_1px_var(--border)] ${className}`}
    >
      <span className="mb-0.5 block text-[0.8125rem] font-semibold text-haze">
        {label}
        <span className="sr-only"> says:</span>
      </span>
      {line}
    </p>
  );
}
