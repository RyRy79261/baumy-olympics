// Pixel art as character grids, Camp 404's "#"-grid technique (ADR 0005 §7):
// one character per pixel, a palette maps characters to colours, and any
// character the palette does not name is clear. Pure functions, so the
// frame maths is tested without a browser.

/** One frame: equal-length rows of characters, top to bottom. */
export type Sprite = readonly string[];

/** Which colour each character paints. */
export type Palette = Readonly<Record<string, string>>;

/** A frame's width (its longest row) and height. */
export function gridSize(grid: Sprite): { w: number; h: number } {
  return {
    w: grid.reduce((m, row) => Math.max(m, row.length), 0),
    h: grid.length,
  };
}

/**
 * One SVG path per colour, each pixel run on a row merged into one
 * rectangle: a 34 × 32 cat is a handful of paths, not a thousand rects.
 * `dx` shifts the frame right (frames laid side by side in a strip).
 * Colours come out in the order they first appear, so the markup is stable.
 */
export function gridToPaths(
  grid: Sprite,
  palette: Palette,
  dx = 0,
): { fill: string; d: string }[] {
  const byColour = new Map<string, string[]>();
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x]!;
      const fill = palette[ch];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (fill) {
        const runs = byColour.get(fill) ?? [];
        runs.push(`M${x + dx} ${y}h${end - x}v1h${x - end}z`);
        byColour.set(fill, runs);
      }
      x = end;
    }
  });
  return [...byColour].map(([fill, runs]) => ({ fill, d: runs.join("") }));
}
