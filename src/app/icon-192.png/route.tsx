import { ImageResponse } from "next/og";
import { pwaIconElement } from "@/lib/pwa-icon";

// Stable URL for the manifest.ts icons array (Next's auto-generated /icon
// route includes a cache-busting hash query param, not suitable for a
// manifest reference that needs to stay constant).
export async function GET() {
  return new ImageResponse(pwaIconElement(88), { width: 192, height: 192 });
}
