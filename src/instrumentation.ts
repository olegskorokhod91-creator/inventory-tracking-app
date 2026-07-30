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
    // 0, not 1: performance tracing was never what was asked for (just
    // error visibility), and full tracing has a real, documented cost on
    // Vercel serverless specifically - the function has to flush trace
    // data to Sentry's ingest endpoint before it's allowed to freeze,
    // adding real latency to every request. Error capture (captureException,
    // captureRequestError) is unaffected by this setting either way.
    Sentry.init({ dsn, tracesSampleRate: 0 });
  }
}

export const onRequestError = Sentry.captureRequestError;
