import { GallerySection, StateFrame, type SectionProps } from "../_kit";

// Lobby, My runs and History states live beside the components they share:
// the lobby's run cards and locks with the landing (they are the landing's
// RunRow), My runs and History with character creation (they share its
// fixture player). This section is the index, so a reviewer finds every one
// from here instead of a placeholder.

const INDEX: readonly { group: string; states: readonly { id: string; note: string }[] }[] = [
  {
    group: "Lobby (/pools, /c/[token])",
    states: [
      { id: "lobby-cards", note: "run cards by slot, signed in: playable, locked, joined, ended" },
      { id: "lobby-signed-out-picked", note: "signed out with WHOOP picked: the step run reads locked" },
      { id: "lobby-challenge-highlight", note: "the challenge link's run, marked, with its entry control" },
      { id: "lobby-lock-sensor-check", note: "the one tap at the top of the lobby" },
      { id: "lobby-lock-hardware", note: "a hardware limit with the fix as the one action" },
      { id: "lobby-lock-paused", note: "a build-wide pause" },
      { id: "landing-no-open-runs", note: "nothing live: start a run" },
    ],
  },
  {
    group: "My runs (/dashboard)",
    states: [
      { id: "my-runs-signed-out", note: "sign in on the card SPOTTER stands on" },
      { id: "my-runs-loading", note: "reading the runs" },
      { id: "my-runs-empty", note: "in no run: one pose, one line, one action" },
      { id: "my-runs-active", note: "in a live run: nights, If you hit, Who's in" },
      { id: "my-runs-finished", note: "finished runs only" },
      { id: "my-runs-error", note: "the read failed" },
    ],
  },
  {
    group: "History (/agent)",
    states: [
      { id: "history-feed", note: "claims with badges and tx links" },
      { id: "history-empty", note: "nothing checked yet" },
    ],
  },
];

export default function LobbyStates({ meta }: SectionProps) {
  return (
    <GallerySection meta={meta}>
      <StateFrame name="lobby-index" note="where each lobby, My runs and History state is rendered">
        <div className="grid gap-6 min-[900px]:grid-cols-3">
          {INDEX.map(({ group, states }) => (
            <div key={group}>
              <h3 className="m-0 text-base font-semibold text-foreground">{group}</h3>
              <ul className="m-0 mt-2 list-none p-0">
                {states.map((s) => (
                  <li key={s.id} className="border-t border-edge py-2 text-[0.9375rem] first:border-t-0">
                    <a
                      href={`?#${s.id}`}
                      className="font-medium text-foreground underline decoration-muted/35 underline-offset-4"
                    >
                      #{s.id}
                    </a>
                    <span className="block text-[0.8125rem] text-haze">{s.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </StateFrame>
    </GallerySection>
  );
}
