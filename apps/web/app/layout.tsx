import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { APP_BACKGROUND } from "@/components/app-icon";
import { Toaster } from "@/components/toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: "Baumy Olympics",
  description: "The Baumschulenweg household hub.",
  // Added to the iPad's home screen, it opens without Safari's bars (the
  // manifest, app/manifest.ts, says the same to every other browser).
  appleWebApp: { capable: true, title: "Baumy", statusBarStyle: "black" },
};

export const viewport: Viewport = { themeColor: APP_BACKGROUND };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
