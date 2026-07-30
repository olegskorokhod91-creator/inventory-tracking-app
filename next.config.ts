import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  // No SENTRY_AUTH_TOKEN configured (would need its own account-level
  // secret beyond the DSN) - source map upload is explicitly off rather
  // than silently skipped, so a stack trace shows minified code for now.
  // Revisit if that becomes a real debugging blocker.
  sourcemaps: { disable: true },
  silent: true,
});
