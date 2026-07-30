import * as Sentry from "@sentry/nextjs";

// Auto-loaded by Next.js on the client (this filename is the framework
// convention, not a Sentry-specific import someone needs to wire up).
// NEXT_PUBLIC_SENTRY_DSN is optional on purpose - local dev typically won't
// set it, and Sentry.init just no-ops without a dsn rather than erroring.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // 0, not 1 - matches instrumentation.ts: performance tracing wasn't what
  // was asked for, and it adds real client-side instrumentation overhead
  // (intercepting every fetch/navigation to create spans) for no benefit
  // this app currently needs. Error capture is unaffected.
  tracesSampleRate: 0,
});

// Required export for the SDK to instrument client-side route transitions.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
