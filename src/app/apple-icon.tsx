import { ImageResponse } from "next/og";
import { pwaIconElement } from "@/lib/pwa-icon";

// Next.js file-based metadata convention - auto-generates the
// apple-touch-icon <link> tag iOS uses for the home-screen icon when a
// visitor does Share -> Add to Home Screen. 180x180 is Apple's documented
// recommended size.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(pwaIconElement(84), size);
}
