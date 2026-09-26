import type { ReactNode } from "react";

// Building blocks for the dev-only state gallery (app/dev/states/page.tsx).
// A GallerySection is one screen's states; a StateFrame is one state, with an
// id you can link or screenshot by (#run-zero-balance) and an optional phone
// frame so a desktop screenshot still shows the 390px layout.

export interface GallerySectionMeta {
  /** URL-safe id, also the ?only= filter value, e.g. "run". */
  id: string;
  /** Heading shown in the gallery, e.g. "Run page". */
  title: string;
  /** Who fills it, e.g. "foundation", "run-page agent". */
  owner: string;
}

/** What the gallery page hands every section component. */
export interface SectionProps {
  meta: GallerySectionMeta;
}

export function GallerySection({
  meta,
  children,
}: {
  meta: GallerySectionMeta;
  children: ReactNode;
}) {
  return (
    <section id={meta.id} aria-labelledby={`${meta.id}-h`} className="scroll-mt-20 border-t border-edge pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${meta.id}-h`} className="type-title m-0 text-[2rem] min-[900px]:text-[2.5rem]">
          {meta.title}
        </h2>
        <p className="m-0 text-[0.8125rem] text-haze">
          <a href={`?only=${meta.id}`} className="text-muted underline decoration-muted/35 underline-offset-4">
            Only this section
          </a>{" "}
          <span>(owner: {meta.owner})</span>
        </p>
      </div>
      <div className="mt-6 grid gap-10">{children}</div>
    </section>
  );
}

export function StateFrame({
  name,
  note,
  phone = false,
  children,
}: {
  /** Kebab-case state id, unique across the gallery, e.g. "run-zero-balance". */
  name: string;
  /** One line on what this state is and what triggers it. */
  note?: string;
  /** Constrain to 390px so a desktop screenshot shows the phone layout. */
  phone?: boolean;
  children: ReactNode;
}) {
  return (
    <div id={name} className="scroll-mt-20">
      <p className="m-0 mb-3 font-mono text-xs text-haze">
        #{name}
        {note !== undefined ? <span className="font-sans">: {note}</span> : null}
      </p>
      <div
        className={
          phone
            ? "w-full max-w-[390px] rounded-card px-4 py-4 shadow-[inset_0_0_0_1px_var(--border)]"
            : ""
        }
      >
        {children}
      </div>
    </div>
  );
}

/** Placeholder for a section a screen agent has not filled yet. */
export function PendingStates({ owner, states }: { owner: string; states: readonly string[] }) {
  return (
    <p className="m-0 max-w-[70ch] text-[0.9375rem] text-muted">
      Not ported yet. The {owner} adds these states here with fixture props:{" "}
      <span className="font-mono text-xs text-haze">{states.join(", ")}</span>.
    </p>
  );
}
