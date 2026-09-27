import { ImageResponse } from "next/og";

// PLACEHOLDER app icon (issue #29): a blocky pixel "B" on a flat square,
// drawn from a bitmap so it stays crisp at any size. The owner's pixel
// Baumy (from design/baumy-reference.png) replaces the bitmap and colours
// here once it is approved (issue #7); app/icon.tsx, app/apple-icon.tsx and
// app/manifest.ts only ask for a size.

/** The theme colour the manifest and the status bar use. */
export const APP_BACKGROUND = "#171717";
const INK = "#fafafa";

// 7 × 9 cells; "#" is a lit pixel.
const GLYPH = [
  "######.",
  "##...##",
  "##...##",
  "##...##",
  "######.",
  "##...##",
  "##...##",
  "##...##",
  "######.",
];

/**
 * A square PNG `size` px wide. `maskable` keeps the glyph inside the middle
 * 60% (the safe zone launchers never crop); otherwise it fills 70%.
 */
export function renderAppIcon(size: number, maskable = false): ImageResponse {
  const cell = Math.floor((size * (maskable ? 0.6 : 0.7)) / GLYPH.length);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: APP_BACKGROUND,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        {GLYPH.map((row, y) => (
          <div key={y} style={{ display: "flex" }}>
            {[...row].map((px, x) => (
              <div
                key={x}
                style={{
                  width: cell,
                  height: cell,
                  backgroundColor: px === "#" ? INK : "transparent",
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>,
    { width: size, height: size },
  );
}
