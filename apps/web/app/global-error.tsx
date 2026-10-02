"use client";

import { useEffect } from "react";

// The last resort (issue #133, after camp-404 `app/global-error.tsx`): an
// error in the root layout itself. It REPLACES that layout, so it brings its
// own <html> and <body> and cannot use the app's CSS or fonts: inline styles
// in the pixel kit's colours, so it still reads as Baumy. The reporter is not
// mounted here; Try again is the way on.

const BG = "#140c1f"; // --color-bm-bg
const TEXT = "#f7ecff"; // --color-bm-text
const MUTED = "#a898c4"; // --color-bm-muted
const GREEN = "#43f0a0"; // --color-bm-green

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "3rem 1.5rem",
          boxSizing: "border-box",
          background: BG,
          color: TEXT,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          textAlign: "center",
        }}
      >
        <main
          style={{
            maxWidth: "28rem",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>
            Baumy hit a snag.
          </h1>
          <p style={{ margin: 0, color: MUTED }}>
            Something failed before the page could load. Try again; if it
            keeps happening, tell a household admin.
          </p>
          {error.digest ? (
            <p style={{ margin: 0, color: MUTED, fontSize: "0.75rem" }}>
              Trace: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: "pointer",
              minHeight: "3.5rem",
              border: "none",
              padding: "0 2rem",
              fontFamily: "inherit",
              fontSize: "1rem",
              background: GREEN,
              color: BG,
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
