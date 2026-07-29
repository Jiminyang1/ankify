"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";

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
      <Button
        variant="primary"
        onClick={signIn}
        disabled={pending}
        className="w-full"
      >
        {pending ? t.login.redirecting : t.login.continueGoogle}
      </Button>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
