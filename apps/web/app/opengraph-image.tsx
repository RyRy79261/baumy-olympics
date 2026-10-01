import {
  renderShareImage,
  SHARE_ALT,
  SHARE_CONTENT_TYPE,
  SHARE_SIZE,
} from "@/lib/brand/share-image";

// The Open Graph card (issue #122) that Telegram, WhatsApp, iMessage, Slack
// and the rest show for a link to the app. Built once at build time; the
// artwork is lib/brand/share-image.tsx. Copied from camp-404's
// apps/web/app/opengraph-image.tsx.
export const alt = SHARE_ALT;
export const size = SHARE_SIZE;
export const contentType = SHARE_CONTENT_TYPE;

export default function OpengraphImage() {
  return renderShareImage();
}
