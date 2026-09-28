"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { Surface } from "@/components/ui/surface";

const copy = {
  en: {
    title: "Terms of use",
    updated: "Last updated: July 25, 2026",
    intro:
      "By using ankify or its Chrome extension, you agree to these terms. If you do not agree, do not use the service.",
    items: [
      ["Permitted use", "Use ankify for lawful personal study. Do not attack, probe, overload, scrape, resell, or interfere with the service or other users."],
      ["Your content", "You remain responsible for content you capture or create and must have the right to process it. Do not store secrets, employer-confidential code, or other sensitive third-party data."],
      ["LeetCode and third parties", "ankify is independent and is not endorsed by LeetCode. Your use of LeetCode, Google, Vercel, Turso, Stripe, and AI providers remains subject to their own terms and policies."],
      ["AI features and costs", "AI output can be inaccurate and must be reviewed. When you supply your own provider credentials, you are responsible for provider usage, charges, limits, and compliance."],
      ["AI credits", "Purchased AI credits are one-time, prepaid purchases processed by Stripe. They do not expire, have no cash value, and can only be used for AI features on ankify's hosted AI key. Purchases are final and non-refundable. Deleting your account permanently forfeits any remaining credits; they cannot be refunded or restored. An AI card uses 1 credit, a quiz 2, and a Study Coach message 5. Credits spent on a generation that fails are returned automatically; a Study Coach reply that is interrupted before it finishes (for example by reloading or leaving the page) still uses its credits."],
      ["Availability", "The service is provided as-is and may change, suspend, or lose availability. Export important data and keep your own backups where appropriate."],
      ["Liability", "To the maximum extent permitted by law, the project operator is not liable for indirect loss, lost data, provider charges, interview outcomes, or reliance on generated content."],
      ["Termination", "You may delete your account at any time. Access may be limited or terminated for abuse, security risk, or violation of these terms."],
      ["Changes", "These terms may be updated as the service changes. The date above identifies the current version."],
    ],
    privacy: "Privacy policy",
  },
  zh: {
    title: "使用条款",
    updated: "最后更新：2026 年 7 月 25 日",
    intro: "使用 ankify 或其 Chrome 扩展即表示你同意本条款；如不同意，请勿使用。",
    items: [
      ["允许的用途", "仅将 ankify 用于合法的个人学习。不得攻击、探测、过载、抓取、转售或干扰服务及其他用户。"],
      ["你的内容", "你对捕获或创建的内容负责，并应有权处理这些内容。请勿存储密钥、雇主机密代码或其他敏感第三方数据。"],
      ["LeetCode 与第三方", "ankify 是独立项目，未获 LeetCode 背书。你使用 LeetCode、Google、Vercel、Turso、Stripe 和 AI 提供商时仍受各自条款与政策约束。"],
      ["AI 功能与费用", "AI 输出可能不准确，必须自行审核。使用自己的供应商凭据时，你负责使用量、费用、限制及合规。"],
      ["AI 额度", "购买的 AI 额度是由 Stripe 处理的一次性预付购买，永不过期、不可兑换现金，仅可用于 ankify 托管 AI key 上的 AI 功能。购买一经完成即不予退款。删除账号会永久作废剩余额度，且无法退款或恢复。AI 卡片消耗 1 点额度，测验 2 点，Study Coach 消息 5 点。生成失败时消耗的额度会自动退还；在完成前被中断（例如刷新或离开页面）的 Study Coach 回复仍会消耗额度。"],
      ["可用性", "服务按现状提供，可能变更、暂停或不可用。重要数据应及时导出，并在适当情况下自行备份。"],
      ["责任限制", "在法律允许的最大范围内，项目运营者不对间接损失、数据丢失、供应商费用、面试结果或依赖生成内容承担责任。"],
      ["终止", "你可以随时删除账号。滥用、安全风险或违反条款时，访问可能被限制或终止。"],
      ["变更", "条款会随服务变化更新；上方日期标识当前版本。"],
    ],
    privacy: "隐私政策",
  },
} as const;

export function TermsContent() {
  const { language } = useLanguage();
  const t = copy[language];
  return (
    <Surface className="mx-auto max-w-3xl p-6 sm:p-8">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="mt-2 text-sm text-muted">{t.updated}</p>
      <p className="mt-5 text-sm leading-7">{t.intro}</p>
      <div className="mt-7 space-y-6">
        {t.items.map(([title, body]) => (
          <section key={title}>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-7 text-muted">{body}</p>
          </section>
        ))}
      </div>
      <p className="mt-8 border-t border-border pt-5 text-sm">
        <Link href="/privacy" className="font-medium text-accent hover:underline">
          {t.privacy}
        </Link>
      </p>
    </Surface>
  );
}
