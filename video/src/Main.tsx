// The one composition. Assembles the six scenes with <Series>, driven entirely by
// props: `lang` picks the i18n dictionary and font stack, so the SAME component
// renders in EN / zh / fil. Dimensions (1:1, 9:16, 16:9) come from the registered
// composition, so aspect is a render-time choice, not a code change.
import React from "react";
import { AbsoluteFill, Audio, Series, staticFile } from "remotion";
import { dict, type Lang } from "./i18n";
import { sansFamily } from "./fonts";
import { theme } from "./theme";
import { Hook } from "./scenes/Hook";
import { MeetSpotter } from "./scenes/MeetSpotter";
import { HowItWorks } from "./scenes/HowItWorks";
import { TheDrop } from "./scenes/TheDrop";
import { TheCurrent } from "./scenes/TheCurrent";
import { CTA } from "./scenes/CTA";

export type MainProps = { lang: Lang };

// Scene durations at 30fps. Sum drives the composition length (see Root).
export const FPS = 30;
export const SCENES = {
  hook: 210, // 7.0s
  meet: 180, // 6.0s
  how: 300, // 10.0s
  drop: 420, // 14.0s
  current: 360, // 12.0s
  cta: 330, // 11.0s
} as const;
export const TOTAL_FRAMES = Object.values(SCENES).reduce((a, b) => a + b, 0); // 1800 = 60s

export const Main: React.FC<MainProps> = ({ lang }) => {
  const d = dict[lang];
  const sans = sansFamily(lang);
  return (
    <AbsoluteFill style={{ background: theme.background, fontFamily: sans }}>
      {/* Warm ambient bed under the whole film. Subtle; the coin chime at THE
          DROP is the only accent. Volume kept low so the copy carries. */}
      <Audio src={staticFile("audio/ambient.mp3")} volume={0.32} />
      <Series>
        <Series.Sequence durationInFrames={SCENES.hook}>
          <Hook d={d} sans={sans} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.meet}>
          <MeetSpotter d={d} sans={sans} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.how}>
          <HowItWorks d={d} sans={sans} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.drop}>
          <TheDrop d={d} sans={sans} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.current}>
          <TheCurrent d={d} sans={sans} />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SCENES.cta}>
          <CTA d={d} sans={sans} />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
