import { ImageResponse } from "next/og";
import { pwaIconElement } from "@/lib/pwa-icon";

// Android's adaptive-icon system crops a maskable icon to arbitrary shapes
// (circle, squircle, etc.), so the meaningful content needs to sit inside
// roughly the inner 80% "safe zone" rather than filling the full canvas the
// way icon-512.png does - hence the smaller font size at the same
// dimensions, not a different background/layout.
export async function GET() {
  return new ImageResponse(pwaIconElement(160), { width: 512, height: 512 });
}
