import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NIGHT_PALETTE as N } from "@/lib/night-palette";

// The share card behind og:image and twitter:image on every page, in Night
// Shift (docs/DESIGN.md): the night field, the moon, SPOTTER asleep in front of
// it, the headline and the testnet line. Rendered once at build (no request-
// time input). The renderer cannot read CSS variables or WebP, so colours come
// from lib/night-palette.ts and the art from PNGs in public/brand/ (written by
// scripts/relight-spotter.mjs). Nothing here names a price or a return.
export const alt = "GoHealthMe: put money on yourself. Your wearable decides.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function dataUrl(file: string): Promise<string> {
  const buf = await readFile(join(process.cwd(), file));
  return `data:image/png;base64,${buf.toString("base64")}`;
}

export default async function Image() {
  const [otter, mark] = await Promise.all([
    dataUrl("public/brand/og-sleep.png"),
    dataUrl("public/brand/mark-512.png"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          padding: "64px 72px",
          background: `radial-gradient(60% 70% at 80% 30%, rgba(246,228,182,0.14), transparent 70%), ${N.background}`,
          color: N.foreground,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: 620,
            height: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <img src={mark} alt="" width={56} height={56} style={{ width: 56, height: 56 }} />
            <div style={{ display: "flex", fontSize: 36, fontWeight: 700, letterSpacing: -0.5 }}>
              GoHealthMe
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div
              style={{ display: "flex", fontSize: 84, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2 }}
            >
              Put money on yourself.
            </div>
            <div style={{ display: "flex", fontSize: 32, color: N.muted, lineHeight: 1.3 }}>
              Stake on your sleep or workouts. Your wearable decides.
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 22, color: N.haze }}>
            Beta on Base Sepolia with test USDC. No real money moves.
          </div>
        </div>
        {/* The moon, and SPOTTER asleep in front of it. */}
        <div
          style={{
            position: "absolute",
            right: 70,
            top: 90,
            width: 330,
            height: 330,
            borderRadius: 330,
            background: `radial-gradient(circle at 36% 32%, ${N.moon1} 0%, ${N.moon2} 45%, ${N.moon3} 82%, ${N.moon4} 100%)`,
            boxShadow: "0 0 120px 30px rgba(246,228,182,0.22)",
          }}
        />
        <img
          src={otter}
          alt=""
          width={440}
          height={319}
          style={{ position: "absolute", right: 170, top: 250, width: 440, height: 319 }}
        />
      </div>
    ),
    { ...size },
  );
}
