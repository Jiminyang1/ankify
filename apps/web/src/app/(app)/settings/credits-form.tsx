"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export type BillingNotice = "success" | "pending" | "cancelled" | null;

type Pack = { id: string; credits: number; unitAmount: number; currency: string };
type Purchase = {
  id: string;
  credits: number;
  amountTotal: number;
  currency: string;
  status: "paid" | "refunded";
  createdAt: string;
};

function formatMoney(amount: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
}

export function CreditsSettingsForm({
  status,
  packs,
  purchases,
  notice,
}: {
  status: { starterRemaining: number; starterLimit: number; paidBalance: number; billingEnabled: boolean };
  packs: Pack[];
  purchases: Purchase[];
  notice: BillingNotice;
}) {
  const { t, language } = useLanguage();
  const locale = language === "zh" ? "zh-CN" : "en-US";
  const [pendingPack, setPendingPack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function buy(packId: string) {
    setPendingPack(packId);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const body = (await res.json().catch(() => null)) as { url?: string; message?: string } | null;
      if (!res.ok || !body?.url) throw new Error(body?.message ?? t.settings.checkoutFailed);
      window.location.assign(body.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.settings.checkoutFailed);
      setPendingPack(null);
    }
  }

  const noticeText =
    notice === "success"
      ? t.settings.billingSuccess
      : notice === "pending"
        ? t.settings.billingPending
        : notice === "cancelled"
          ? t.settings.billingCancelled
          : null;

  return (
    <div className="max-w-2xl space-y-4">
      {noticeText && (
        <p
          role="status"
          className={
            notice === "cancelled"
              ? "rounded-lg border border-border bg-subtle px-3 py-2 text-sm leading-6 text-fg"
              : "rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm leading-6 text-fg"
          }
        >
          {noticeText}
        </p>
      )}

      <div className="space-y-1 text-sm">
        {status.starterLimit > 0 && (
          <p className="tabular-nums text-fg">{t.settings.creditsFree(status.starterRemaining, status.starterLimit)}</p>
        )}
        <p className="tabular-nums text-fg">{t.settings.creditsPaid(status.paidBalance)}</p>
        <p className="leading-6 text-muted">{t.settings.creditsCost}</p>
      </div>

      {status.billingEnabled && (
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-medium text-fg">{t.settings.buyCredits}</h3>
          <div className="flex flex-wrap gap-2">
            {packs.map((pack) => (
              <Button
                key={pack.id}
                type="button"
                disabled={pendingPack !== null}
                onClick={() => void buy(pack.id)}
                className="tabular-nums"
              >
                {pendingPack === pack.id && <Spinner />}
                {t.settings.creditPack(pack.credits, formatMoney(pack.unitAmount, pack.currency, locale))}
              </Button>
            ))}
          </div>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <p className="text-xs leading-5 text-muted">{t.settings.creditsNeverExpire}</p>
        </div>
      )}

      {purchases.length > 0 && (
        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-medium text-fg">{t.settings.purchaseHistory}</h3>
          <ul className="divide-y divide-border text-sm">
            {purchases.map((purchase) => (
              <li key={purchase.id} className="flex items-center justify-between gap-3 py-2 tabular-nums">
                <span className="text-muted">
                  {new Date(purchase.createdAt).toLocaleDateString(locale)}
                </span>
                <span className="text-fg">
                  {t.settings.creditPack(purchase.credits, formatMoney(purchase.amountTotal, purchase.currency, locale))}
                </span>
                {purchase.status === "refunded" && (
                  <span className="text-xs text-muted">{t.settings.purchaseRefunded}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
