import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The share card behind og:image and twitter:image on every page. Rendered
// once at build (no request-time input), so it is a static PNG in production.
// Copy is the locked one-liner plus the testnet chip; nothing here names a
// price, a return, or anything that could read as real money.
export const alt =
  "GoHealthMe - pay someone in USDC the second they hit their health goal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand tokens mirrored from globals.css. The card cannot read CSS variables,
// so the values are pinned here; keep them in step with the stylesheet.
const CREAM = "#faf6ee";
const INK = "#16211b";
const MUTED = "#5f6f64";
const EMERALD = "#059669";
const EMERALD_SOFT = "#d1fae5";

export default async function Image() {
  // process.cwd() is the Next project directory (app/) at build and at runtime.
  const otter = await readFile(
    join(process.cwd(), "public/spotter/spotter-wave.png"),
  );
  const otterSrc = `data:image/png;base64,${otter.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: CREAM,
          color: INK,
          fontFamily: "Geist, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            height: "100%",
            width: 760,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 40,
              fontWeight: 700,
              color: EMERALD,
              letterSpacing: -1,
            }}
          >
            GoHealthMe
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 54,
              fontWeight: 700,
              lineHeight: 1.12,
              letterSpacing: -1.5,
            }}
          >
            You can&apos;t Venmo your grandma in another country to go for a
            walk. You can pay her in USDC the second she does.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                padding: "10px 18px",
                borderRadius: 999,
                background: EMERALD_SOFT,
                color: EMERALD,
                fontSize: 22,
                fontWeight: 600,
              }}
            >
              Testnet, play-money USDC on Base Sepolia
            </div>
            <div style={{ display: "flex", fontSize: 22, color: MUTED }}>
              Stake on your health goal. Hit it, get paid in USDC.
            </div>
          </div>
        </div>
        {/* SPOTTER waving, 637x1000 scaled to the card height. */}
        <img
          src={otterSrc}
          alt=""
          width={318}
          height={500}
          style={{ width: 318, height: 500 }}
        />
      </div>
    ),
    { ...size },
  );
}
