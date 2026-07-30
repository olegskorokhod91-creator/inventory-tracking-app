import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Order Tracker",
  description: "Order tracking for short-term rental properties",
  appleWebApp: {
    // iOS's own PWA install path - "Add to Home Screen" from Safari's
    // share sheet. capable:true drops the browser chrome (address bar,
    // back/forward) once launched from the home screen icon.
    capable: true,
    title: "Order Tracker",
    statusBarStyle: "default",
  },
  other: {
    // Next's Metadata API only emits the modern "mobile-web-app-capable"
    // tag for appleWebApp.capable above - older iOS Safari versions only
    // ever recognized this Apple-prefixed one, so it's added explicitly
    // for broader compatibility rather than relying on the newer tag alone.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
