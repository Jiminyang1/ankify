"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { Surface } from "@/components/ui/surface";

const copy = {
  en: {
    title: "Privacy policy",
    updated: "Last updated: July 25, 2026",
    intro:
      "ankify is a spaced-repetition service and Chrome extension for reviewing LeetCode work. This policy explains what data is processed and why.",
    sections: [
      {
        title: "Data we process",
        body: [
          "Google account identity used for authentication: user id, name, email address, profile image, sessions, and account linkage.",
          "Study data you choose to capture or create: LeetCode problem metadata and statements, submission code and results, notes, cards, quizzes, answers, review events, and scheduling state.",
          "Configuration data: review settings and encrypted AI-provider key envelopes. Raw AI keys are encrypted before storage.",
          "Basic operational and page-usage telemetry provided by the hosting platform. We do not sell personal data or use it for advertising.",
        ],
      },
      {
        title: "Chrome extension behavior",
        body: [
          "The extension runs only on LeetCode problem pages. It reads the current problem and your recent submission details from LeetCode when you capture or sync.",
          "It may check whether the open problem has a recent accepted submission so it can show a capture reminder. Submission source code is not sent to ankify until you choose capture or sync.",
          "The extension stores its API origin, preferences, and drafts in Chrome local storage. It reuses the ankify web session cookie through credentialed requests and does not store a separate ankify API token.",
        ],
      },
      {
        title: "How data is used and shared",
        body: [
          "Data is used to provide authentication, capture, review scheduling, quizzes, cards, history, data export, and account support.",
          "Hosting and database processing may be provided by Vercel and Turso. Google processes OAuth sign-in. When you use AI features, the selected context is sent to the AI provider whose key you configured (Anthropic, OpenAI, DeepSeek, or a compatible provider) under that provider's terms.",
          "We do not disclose your study data to unrelated third parties unless required by law or necessary to protect the service.",
        ],
      },
      {
        title: "Retention, security, and your choices",
        body: [
          "Data is retained while your account exists. You can export a streaming NDJSON copy or permanently delete the account and its associated database rows from Settings.",
          "You can sign out of the web session or remove the stored AI key at any time. Provider keys are encrypted at rest with AES-GCM, and access to user-owned records is scoped by user id.",
          "No internet service can guarantee absolute security. Sign out of ankify if a device or browser profile is compromised.",
        ],
      },
    ],
    contact: "Questions or privacy requests",
    contactBody: "Open an issue in the project repository:",
    terms: "Terms of use",
  },
  zh: {
    title: "隐私政策",
    updated: "最后更新：2026 年 7 月 25 日",
    intro:
      "ankify 是用于复习 LeetCode 学习内容的间隔重复服务与 Chrome 扩展。本政策说明我们处理哪些数据以及处理目的。",
    sections: [
      {
        title: "我们处理的数据",
        body: [
          "用于登录的 Google 账号信息：用户 id、姓名、邮箱、头像、会话和账号关联信息。",
          "你主动捕获或创建的学习数据：LeetCode 题目信息与题面、提交代码与结果、笔记、卡片、测验、答案、复习事件和调度状态。",
          "配置数据：复习设置和加密后的 AI 提供商密钥信封。AI key 会先加密再存储。",
          "托管平台提供的基础运行与页面使用遥测。我们不会出售个人数据，也不会将其用于广告。",
        ],
      },
      {
        title: "Chrome 扩展如何工作",
        body: [
          "扩展只在 LeetCode 题目页运行。你选择捕获或同步时，它会读取当前题目及你的近期提交详情。",
          "扩展可能检查当前题目是否有近期通过记录，以提示你捕获。只有在你选择捕获或同步后，提交源代码才会发送到 ankify。",
          "扩展会在 Chrome 本地存储 API 地址、偏好和草稿。它通过带凭据请求复用 ankify 网页会话 cookie，不再单独存储 ankify API token。",
        ],
      },
      {
        title: "数据用途与共享",
        body: [
          "数据用于提供登录、捕获、复习调度、测验、卡片、历史、数据导出和账号支持。",
          "Vercel 和 Turso 可能分别处理托管与数据库数据；Google 处理 OAuth 登录。使用 AI 功能时，选定上下文会发送给你配置 key 的 AI 提供商（Anthropic、OpenAI、DeepSeek 或兼容提供商），并受该提供商条款约束。",
          "除法律要求或保护服务所必需外，我们不会向无关第三方披露你的学习数据。",
        ],
      },
      {
        title: "保留、安全与选择",
        body: [
          "账号存在期间会保留数据。你可以在设置中导出流式 NDJSON 副本，或永久删除账号及其关联数据库记录。",
          "你可以随时退出网页登录会话或移除已保存的 AI key。提供商 key 使用 AES-GCM 加密存储，用户数据查询按 user id 隔离。",
          "任何互联网服务都无法保证绝对安全；设备或浏览器配置泄露时应立即退出 ankify。",
        ],
      },
    ],
    contact: "问题或隐私请求",
    contactBody: "请在项目仓库提交 issue：",
    terms: "使用条款",
  },
} as const;

export function PrivacyContent() {
  const { language } = useLanguage();
  const t = copy[language];

  return (
    <Surface className="mx-auto max-w-3xl p-6 sm:p-8">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="mt-2 text-sm text-muted">{t.updated}</p>
      <p className="mt-5 text-sm leading-7">{t.intro}</p>
      <div className="mt-7 space-y-7">
        {t.sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-lg font-semibold">{section.title}</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-muted">
              {section.body.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
        <section>
          <h2 className="text-lg font-semibold">{t.contact}</h2>
          <p className="mt-3 text-sm text-muted">
            {t.contactBody}{" "}
            <a
              href="https://github.com/Jiminyang1/ankify/issues"
              className="font-medium text-accent hover:underline"
              rel="noreferrer"
            >
              github.com/Jiminyang1/ankify/issues
            </a>
          </p>
        </section>
      </div>
      <p className="mt-8 border-t border-border pt-5 text-sm">
        <Link href="/terms" className="font-medium text-accent hover:underline">
          {t.terms}
        </Link>
      </p>
    </Surface>
  );
}
