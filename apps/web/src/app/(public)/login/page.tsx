import { Surface } from "@/components/ui/surface";
import { BrandLockup } from "@/components/brand";
import { buttonClasses } from "@/components/ui/button";
import { safeNextPath } from "@/lib/safe-next";
import { getOptionalPageUser, isSignupEnabled } from "@/server/auth";
import { getRequestTranslations } from "@/server/i18n";
import { isQaProfile } from "@/server/qa";
import { GoogleSignInButton } from "./google-button";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const user = await getOptionalPageUser();
  if (user) redirect(next);
  const signupEnabled = isSignupEnabled();
  const qa = isQaProfile();
  const t = await getRequestTranslations();

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-sm items-center">
      <Surface className="w-full p-6">
        <BrandLockup size="md" showTag />
        <h1 className="mt-5 text-xl font-semibold">{t.login.title}</h1>
        <p className="mt-2 text-sm text-muted">
          {qa ? t.login.qaHint : signupEnabled ? t.login.openSignup : t.login.allowlist}
        </p>
        {params.error && (
          <p className="mt-3 text-sm text-danger">
            {signupEnabled ? t.login.failedOpen : t.login.failedAllowlist}
          </p>
        )}
        {qa ? (
          // The local QA profile has no Google sign-in; these sign in again
          // after a sign-out, then continue (for example to the extension).
          <div className="mt-5 space-y-3">
            <a href={`/api/qa/login?next=${encodeURIComponent(next)}`} className={buttonClasses({ variant: "primary", className: "w-full" })}>
              {t.login.qaSignIn}
            </a>
            <a href={`/api/qa/login?account=second&next=${encodeURIComponent(next)}`} className={buttonClasses({ variant: "secondary", className: "w-full" })}>
              {t.login.qaSecond}
            </a>
          </div>
        ) : (
          <GoogleSignInButton next={next} />
        )}
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
