import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center">
      <Surface className="w-full p-6 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-muted">404</p>
        <h1 className="mt-1 text-lg font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted">
          The page you&rsquo;re looking for doesn&rsquo;t exist or may have been removed.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Link href="/" className={buttonClasses({ variant: "primary" })}>
            Go home
          </Link>
          <Link href="/problems" className={buttonClasses({ variant: "secondary" })}>
            Browse problems
          </Link>
        </div>
      </Surface>
    </div>
  );
}
