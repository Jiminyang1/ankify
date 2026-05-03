import { Surface } from "@/components/ui/surface";

export const dynamic = "force-dynamic";

function cleanNext(next: string | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/api/")) return "/";
  return next;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = cleanNext(params.next);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-sm items-center">
      <Surface className="w-full p-6">
        <h1 className="text-xl font-semibold">Unlock ankify</h1>
        <p className="mt-2 text-sm text-muted">Enter your app password to use this personal deck.</p>

        <form action="/api/auth/login" method="post" className="mt-5 space-y-4">
          <input type="hidden" name="next" value={next} />
          <label className="block space-y-1">
            <span className="text-sm">Password</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
            />
          </label>

          {params.error && <p className="text-sm text-danger">Wrong password.</p>}

          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white shadow-card hover:opacity-90"
          >
            Continue
          </button>
        </form>
      </Surface>
    </div>
  );
}
