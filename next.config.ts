import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  experimental: {
    // Default is 1MB, well below what a handful of Amazon invoice PDFs
    // (uploaded together on /orders/reconcile-invoice) add up to - a batch
    // upload was silently rejected before the server action even ran,
    // surfacing to the browser as a generic client-side exception with no
    // useful message. Raised to just under Vercel's own platform-level
    // ~4.5MB request body ceiling (a hard limit this setting can't override
    // regardless of how high it's set), so this covers a real multi-file
    // batch without pretending there's no upper bound at all.
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default withSentryConfig(nextConfig, {
  // No SENTRY_AUTH_TOKEN configured (would need its own account-level
  // secret beyond the DSN) - source map upload is explicitly off rather
  // than silently skipped, so a stack trace shows minified code for now.
  // Revisit if that becomes a real debugging blocker.
  sourcemaps: { disable: true },
  silent: true,
});
