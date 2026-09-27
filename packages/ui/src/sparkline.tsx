import { cx } from "./cx";

// NEUTRAL PLACEHOLDER (issue #7 restyles it here): a tiny line chart of a
// short series, for the weights panel's interval history (SPEC §4.4). It
// holds no game logic; the page passes the values and the words.

export interface SparklineProps {
  /** The series, oldest first. Fewer than two values draws no line. */
  values: readonly number[];
  /** What the line shows, for screen readers, e.g. "Gaps: 6, 7, 7 days". */
  label: string;
  width?: number;
  height?: number;
  className?: string;
}

/** An inline SVG polyline scaled to the series' own min and max. */
export function Sparkline({
  values,
  label,
  width = 120,
  height = 28,
  className,
}: SparklineProps) {
  const pad = 2;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = values.length > 1 ? (width - 2 * pad) / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = pad + i * step;
      // A flat series sits in the middle.
      const y =
        hi === lo
          ? height / 2
          : height - pad - ((v - lo) / span) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      data-points={values.length}
      className={cx("inline-block text-neutral-900", className)}
    >
      {values.length > 1 ? (
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        />
      ) : null}
    </svg>
  );
}
