import { ImageResponse } from "next/og";
import { pwaIconElement } from "@/lib/pwa-icon";

// Next.js file-based metadata convention - auto-served as the browser-tab
// favicon and auto-linked into every page's <head>, no manual <link> needed.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(pwaIconElement(18), size);
}
