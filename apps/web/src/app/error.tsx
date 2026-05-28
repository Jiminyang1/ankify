"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";

/**
 * Route-segment error boundary. Catches errors thrown while rendering any page
 * (e.g. a DB hiccup in a server component) and shows a recoverable surface with
 * a Try again (re-runs the segment) plus a route home, instead of a blank or
 * raw Next.js error screen.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center">
      <Surface className="w-full p-6 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          An unexpected error occurred while loading this page. You can try again, or head back home.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-muted">Ref: {error.digest}</p>
        )}
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <Link href="/" className={buttonClasses({ variant: "secondary" })}>
            Go home
          </Link>
        </div>
      </Surface>
    </div>
  );
}
