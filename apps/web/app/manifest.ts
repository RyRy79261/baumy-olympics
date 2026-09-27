import type { MetadataRoute } from "next";
import { APP_BACKGROUND } from "@/components/app-icon";

// The web app manifest (SPEC §8, issue #29; camp-404's app/manifest.ts),
// served at /manifest.webmanifest. Installed from /kiosk, the iPad opens the
// kitchen screen full screen and in landscape. iPadOS ignores `orientation`
// (Guided Access and the rotation lock hold it: docs/kiosk-setup.md);
// Chrome honours it.

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/kiosk",
    name: "Baumy Olympics",
    short_name: "Baumy",
    description: "The Baumschulenweg household hub and kitchen screen.",
    start_url: "/kiosk",
    scope: "/",
    display: "standalone",
    orientation: "landscape",
    background_color: APP_BACKGROUND,
    theme_color: APP_BACKGROUND,
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon/maskable",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
