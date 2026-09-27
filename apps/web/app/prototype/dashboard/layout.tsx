// PROTOTYPE (issue #7), throwaway: pixel fonts for the mockups.

import { Pixelify_Sans, Press_Start_2P, Silkscreen, VT323 } from "next/font/google";
import type { ReactNode } from "react";
import "./proto.css";

const press = Press_Start_2P({ weight: "400", subsets: ["latin"], variable: "--font-press" });
const vt = VT323({ weight: "400", subsets: ["latin"], variable: "--font-vt" });
const silk = Silkscreen({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-silk" });
const pixelify = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pixelify" });

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className={`${press.variable} ${vt.variable} ${silk.variable} ${pixelify.variable}`}>
      {children}
    </div>
  );
}
