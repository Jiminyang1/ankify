import type { Metadata } from "next";
import Link from "next/link";
import { Surface } from "@/components/ui/surface";
import { getRequestLanguage } from "@/lib/i18n-server";

export const metadata: Metadata = {
  title: "Terms of use · ankify",
  description: "Terms governing use of ankify and its Chrome extension.",
};

const copy = {
  en: {
    title: "Terms of use",
    updated: "Last updated: July 25, 2026",
    intro:
      "By using ankify or its Chrome extension, you agree to these terms. If you do not agree, do not use the service.",
    items: [
      ["Permitted use", "Use ankify for lawful personal study. Do not attack, probe, overload, scrape, resell, or interfere with the service or other users."],
      ["Your content", "You remain responsible for content you capture or create and must have the right to process it. Do not store secrets, employer-confidential code, or other sensitive third-party data."],
      ["LeetCode and third parties", "ankify is independent and is not endorsed by LeetCode. Your use of LeetCode, Google, Vercel, Turso, and AI providers remains subject to their own terms and policies."],
      ["AI features and costs", "AI output can be inaccurate and must be reviewed. You supply provider credentials and are responsible for provider usage, charges, limits, and compliance."],
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
      ["LeetCode 与第三方", "ankify 是独立项目，未获 LeetCode 背书。你使用 LeetCode、Google、Vercel、Turso 和 AI 提供商时仍受各自条款与政策约束。"],
      ["AI 功能与费用", "AI 输出可能不准确，必须自行审核。你提供供应商凭据，并负责使用量、费用、限制及合规。"],
      ["可用性", "服务按现状提供，可能变更、暂停或不可用。重要数据应及时导出，并在适当情况下自行备份。"],
      ["责任限制", "在法律允许的最大范围内，项目运营者不对间接损失、数据丢失、供应商费用、面试结果或依赖生成内容承担责任。"],
      ["终止", "你可以随时删除账号。滥用、安全风险或违反条款时，访问可能被限制或终止。"],
      ["变更", "条款会随服务变化更新；上方日期标识当前版本。"],
    ],
    privacy: "隐私政策",
  },
} as const;

export default async function TermsPage() {
  const language = await getRequestLanguage();
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
