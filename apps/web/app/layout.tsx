import type { Metadata, Viewport } from "next";
import { Pixelify_Sans, Press_Start_2P, Silkscreen } from "next/font/google";
import type { ReactNode } from "react";
import { APP_BACKGROUND } from "@/components/app-icon";
import { Toaster } from "@/components/toaster";
import { ROOT_METADATA } from "@/lib/seo";
import "./globals.css";

// The pixel fonts (ADR 0005 §7), self-hosted by next/font. globals.css maps
// them to `font-display`, `font-label` and `font-body`.
const press = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-press",
});
const silk = Silkscreen({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-silk",
});
const pixelify = Pixelify_Sans({
  subsets: ["latin"],
  variable: "--font-pixelify",
});

export const metadata: Metadata = {
  // metadataBase, the "%s · Baumy Olympics" title template, the share
  // card's words and noindex for every page but the landing page, which
  // overrides it (issue #122, lib/seo.ts).
  ...ROOT_METADATA,
  // Added to the iPad's home screen, it opens without Safari's bars (the
  // manifest, app/manifest.ts, says the same to every other browser).
  appleWebApp: { capable: true, title: "Baumy", statusBarStyle: "black" },
};

export const viewport: Viewport = { themeColor: APP_BACKGROUND };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${press.variable} ${silk.variable} ${pixelify.variable}`}
    >
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
