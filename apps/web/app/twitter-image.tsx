import {
  renderShareImage,
  SHARE_ALT,
  SHARE_CONTENT_TYPE,
  SHARE_SIZE,
} from "@/lib/brand/share-image";

// X uses its own image tag (summary_large_image, issue #122): the same card
// as app/opengraph-image.tsx. Copied from camp-404's
// apps/web/app/twitter-image.tsx.
export const alt = SHARE_ALT;
export const size = SHARE_SIZE;
export const contentType = SHARE_CONTENT_TYPE;

export default function TwitterImage() {
  return renderShareImage();
}
