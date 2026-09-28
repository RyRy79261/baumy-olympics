import { cx } from "./cx";

// A completion's proof photo, in a square ink frame (ADR 0005).
// `src` is always the app's own /api/blob proxy link, never a raw Blob URL.

export function ProofPhoto({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    // A plain <img>: the proxy is same-origin and cookie-gated, so the
    // browser must fetch it with the viewer's own cookies.
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={cx(
        "max-h-60 w-auto border-4 border-bm-line bg-bm-ink object-contain",
        className,
      )}
    />
  );
}
