import { PHOTO_MAX_EDGE_PX } from "@/lib/photos/paths";

// Shrink a photo in the browser before it is uploaded (SPEC §6.5): the
// longest edge to 1280px, re-encoded as WebP, or JPEG where the browser
// cannot encode WebP (older Safari hands back a PNG instead). Adapted from
// camp-404 `apps/web/lib/image.ts`, without its square crop: proof should
// show the whole picture. No dependency, canvas only.

const QUALITY = 0.85;

type Drawable = CanvasImageSource & { width: number; height: number };

async function decode(file: Blob): Promise<{ image: Drawable; done(): void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { image: bitmap, done: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that image."));
      el.src = url;
    });
    return { image: img, done: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/** The photo, at most 1280px on its longest edge, as WebP or JPEG. */
export async function downscalePhoto(
  file: Blob,
  maxEdge: number = PHOTO_MAX_EDGE_PX,
): Promise<Blob> {
  const { image, done } = await decode(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot resize photos.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const webp = await encode(canvas, "image/webp");
    if (webp && webp.type === "image/webp") return webp;
    const jpeg = await encode(canvas, "image/jpeg");
    if (!jpeg) throw new Error("Could not prepare that photo.");
    return jpeg;
  } finally {
    done();
  }
}
