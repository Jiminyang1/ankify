"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useLanguage } from "@/components/LanguageProvider";

export function GoogleSignInButton({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLanguage();

  async function signIn() {
    setPending(true);
    setError(null);
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: next,
    });
    if (result.error) {
      setError(result.error.message ?? t.login.googleFailed);
      setPending(false);
    }
  }

  return (
    <div className="mt-5 space-y-3">
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="w-full rounded-md border border-border bg-accent/10 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
      >
        {pending ? t.login.redirecting : t.login.continueGoogle}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
