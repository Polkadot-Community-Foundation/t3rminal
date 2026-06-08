"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Last-resort error boundary for unhandled crashes anywhere in the App
 * Router tree. Sentry's `captureUnderscoreErrorException` records the error
 * with the right context (next.js framework metadata, route, etc.) so it
 * shows up grouped in Issues rather than as a generic crash.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8 gap-4">
        <h2 className="text-xl font-medium">Something went wrong</h2>
        <p className="text-neutral-400 text-sm max-w-md text-center">
          The terminal hit an unexpected error. Try again, and if it keeps
          happening report it to support.
        </p>
        <button
          onClick={() => reset()}
          className="bg-white text-black px-6 py-3 rounded-xl font-medium"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
