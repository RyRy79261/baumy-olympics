// PROTOTYPE (issue #7), throwaway: three calm looks for the portrait kitchen
// dashboard (iPad portrait, 820×1180), switchable with ?variant=A|B|C.
// One skeleton (clock, ≤3 notification icons, full-width calendar); they
// differ in the icon scheme and the calendar view.
// Sample data, no auth, no writes. Lives on branch proto/kiosk-home-pixel only.

import { Suspense } from "react";
import { PrototypeSwitcher } from "./switcher";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

const VARIANTS = [
  { key: "A", name: "Status icons · agenda" },
  { key: "B", name: "Taxonomy icons · week grid" },
  { key: "C", name: "One icon · today timeline" },
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
