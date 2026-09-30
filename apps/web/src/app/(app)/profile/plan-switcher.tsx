"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { Select } from "@/components/ui/field";

export function PlanSwitcher({
  plans,
  current,
}: {
  plans: { slug: string; name: string }[];
  current: string;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function choose(plan: string) {
    if (plan === current) return;
    const res = await fetch("/api/study-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    if (res.ok) startTransition(() => router.refresh());
  }

  return (
    <Select
      aria-label={t.profile.planLabel}
      value={current}
      onValueChange={(plan) => void choose(plan)}
      disabled={pending}
      className="w-56"
    >
      {plans.map((plan) => (
        <option key={plan.slug} value={plan.slug}>
          {plan.name}
        </option>
      ))}
    </Select>
  );
}
