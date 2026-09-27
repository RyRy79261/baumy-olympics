"use client";

// PROTOTYPE (issue #7), throwaway. The floating variant switcher.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export function PrototypeSwitcher({
  variants,
}: {
  variants: { key: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("variant") ?? variants[0]!.key;
  const i = Math.max(0, variants.findIndex((v) => v.key === current));
  const go = (d: number) => {
    const next = variants[(i + d + variants.length) % variants.length]!;
    router.replace(`${pathname}?variant=${next.key}`);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div className="fixed bottom-3 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full bg-white px-2 py-1 font-sans text-sm text-black shadow-2xl ring-2 ring-black">
      <button type="button" onClick={() => go(-1)} className="px-2">←</button>
      <span className="min-w-32 text-center font-semibold">
        {variants[i]!.key} ({variants[i]!.name})
      </span>
      <button type="button" onClick={() => go(1)} className="px-2">→</button>
      <span className="text-neutral-400">|</span>
      <button type="button" onClick={() => window.dispatchEvent(new Event("proto:reminder"))} className="px-2">reminder</button>
      <button type="button" onClick={() => window.dispatchEvent(new Event("proto:screensaver"))} className="px-2">screensaver</button>
    </div>
  );
}
