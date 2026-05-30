import { Surface } from "@/components/ui/surface";
import { BrandLockup } from "@/components/brand";
import { isOpenSignup } from "@/lib/auth";
import { getRequestTranslations } from "@/lib/i18n-server";
import { GoogleSignInButton } from "./google-button";

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
  const openSignup = isOpenSignup();
  const t = await getRequestTranslations();

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-sm items-center">
      <Surface className="w-full p-6">
        <BrandLockup size="md" showTag />
        <h1 className="mt-5 text-xl font-semibold">{t.login.title}</h1>
        <p className="mt-2 text-sm text-muted">
          {openSignup ? t.login.openSignup : t.login.allowlist}
        </p>
        {params.error && (
          <p className="mt-3 text-sm text-danger">
            {openSignup ? t.login.failedOpen : t.login.failedAllowlist}
          </p>
        )}
        <GoogleSignInButton next={next} />
      </Surface>
    </div>
  );
}
