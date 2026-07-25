import { Surface } from "@/components/ui/surface";
import { BrandLockup } from "@/components/brand";
import { getOptionalPageUser, isSignupEnabled } from "@/lib/auth";
import { getRequestTranslations } from "@/lib/i18n-server";
import { GoogleSignInButton } from "./google-button";
import Link from "next/link";
import { redirect } from "next/navigation";

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
  const user = await getOptionalPageUser();
  if (user) redirect(next);
  const signupEnabled = isSignupEnabled();
  const t = await getRequestTranslations();

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-sm items-center">
      <Surface className="w-full p-6">
        <BrandLockup size="md" showTag />
        <h1 className="mt-5 text-xl font-semibold">{t.login.title}</h1>
        <p className="mt-2 text-sm text-muted">
          {signupEnabled ? t.login.openSignup : t.login.allowlist}
        </p>
        {params.error && (
          <p className="mt-3 text-sm text-danger">
            {signupEnabled ? t.login.failedOpen : t.login.failedAllowlist}
          </p>
        )}
        <GoogleSignInButton next={next} />
        <p className="mt-5 text-center text-xs text-muted">
          <Link href="/privacy" className="hover:text-fg hover:underline">
            Privacy
          </Link>
          <span aria-hidden="true"> · </span>
          <Link href="/terms" className="hover:text-fg hover:underline">
            Terms
          </Link>
        </p>
      </Surface>
    </div>
  );
}
