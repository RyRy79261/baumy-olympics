import { renderAppIcon } from "@/components/app-icon";

// The app's icons (issue #29): the browser tab and the manifest's launcher
// sizes, one route per size (/icon/192, /icon/512, /icon/maskable). Built
// once at build time: the Baumy badge (components/app-icon.ts, issue #81).

export function generateImageMetadata() {
  return [
    { id: "32", size: { width: 32, height: 32 }, contentType: "image/png" },
    { id: "192", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "512", size: { width: 512, height: 512 }, contentType: "image/png" },
    {
      id: "maskable",
      size: { width: 512, height: 512 },
      contentType: "image/png",
    },
  ];
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const which = await id;
  if (which === "maskable") return renderAppIcon(512, "maskable");
  return renderAppIcon(Number(which));
}
