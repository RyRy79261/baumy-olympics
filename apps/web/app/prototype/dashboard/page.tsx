// PROTOTYPE (issue #7), throwaway: three looks for the portrait kitchen
// dashboard (iPad portrait, 820×820×1180), switchable with ?variant=A|B|C.
// They differ in icon style, layout and busyness (A calm → C Camp-404 busy).
// Sample data, no auth, no writes. Lives on branch proto/kiosk-home-pixel only.

import { Suspense } from "react";
import { PrototypeSwitcher } from "./switcher";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

const VARIANTS = [
  { key: "A", name: "Calm" },
  { key: "B", name: "Lounge" },
  { key: "C", name: "Busy" },
];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  const { variant = "A" } = await searchParams;
  return (
    <div className="flex min-h-screen justify-center bg-black">
      {variant === "A" && <VariantA />}
      {variant === "B" && <VariantB />}
      {variant === "C" && <VariantC />}
      <Suspense>
        <PrototypeSwitcher variants={VARIANTS} />
      </Suspense>
    </div>
  );
}
