import type { Sprite } from "./pixel-grid";

/**
 * Scale2x (EPX), the pixel-art upscaler: every pixel becomes four, and where
 * two neighbours agree across a corner that quarter takes their colour, so
 * stair-step edges round off and the sprite keeps its shape with twice the
 * detail. Outside the frame counts as clear (".").
 */
export function scale2x(src: Sprite): string[] {
  const h = src.length;
  const w = src.reduce((m, row) => Math.max(m, row.length), 0);
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? "." : (src[y]![x] ?? ".");
  const out: string[][] = Array.from({ length: h * 2 }, () =>
    Array<string>(w * 2).fill("."),
  );
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = at(x, y);
      const a = at(x, y - 1); // above
      const b = at(x + 1, y); // right
      const c = at(x - 1, y); // left
      const d = at(x, y + 1); // below
      out[y * 2]![x * 2] = c === a && c !== d && a !== b ? a : p;
      out[y * 2]![x * 2 + 1] = a === b && a !== c && b !== d ? b : p;
      out[y * 2 + 1]![x * 2] = d === c && d !== b && c !== a ? c : p;
      out[y * 2 + 1]![x * 2 + 1] = b === d && b !== a && d !== c ? d : p;
    }
  }
  return out.map((r) => r.join(""));
}
