"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

// App Router's top-level error boundary - only fires for an error nothing
// else (including per-route error.tsx boundaries, none of which exist yet
// in this app) caught. Replaces the root layout entirely when triggered, so
// it defines its own <html>/<body>.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
