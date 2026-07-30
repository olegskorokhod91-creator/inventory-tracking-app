import * as Sentry from "@sentry/nextjs";

// Server + edge runtime error/performance monitoring. Client-side init lives
// in instrumentation-client.ts (Next.js auto-loads that one; this file is
// for the two server-ish runtimes, per Next.js's instrumentation hook).
export async function register() {
  // Reuses the client-side var name (NEXT_PUBLIC_*) on the server too - a
  // DSN isn't secret (it's meant to be embedded in client bundles), so one
  // env var covers both instead of needing SENTRY_DSN and
  // NEXT_PUBLIC_SENTRY_DSN kept in sync in Vercel.
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({ dsn, tracesSampleRate: 1 });
  }
}

export const onRequestError = Sentry.captureRequestError;
