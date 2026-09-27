import { renderAppIcon } from "@/components/app-icon";

// The iPad's home-screen icon (issue #29). iOS wants a 180px PNG with no
// transparency, and rounds the corners itself.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderAppIcon(180);
}
