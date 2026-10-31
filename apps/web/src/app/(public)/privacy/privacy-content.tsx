"use client";

import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { Surface } from "@/components/ui/surface";

const copy = {
  en: {
    title: "Privacy policy",
    updated: "Last updated: October 30, 2026",
    intro:
      "ankify is a spaced-repetition service and Chrome extension for reviewing LeetCode work. This policy explains what data is processed and why.",
    sections: [
      {
        title: "Data we process",
        body: [
          "Google account identity used for authentication: user id, name, email address, profile image, sessions, and account linkage.",
          "Study data: LeetCode problem metadata and statements, submission code and results, notes, solutions, weak spots, practice sessions and your replies, Study Coach conversations, review events, and scheduling state, plus any cards and quizzes created in earlier versions.",
          "LeetCode account data: the username you link, its public profile, and the list of problems you've solved.",
          "Configuration data: your study plan, review settings, and encrypted AI-provider key envelopes. Raw AI keys are encrypted before storage.",
          "Basic operational and page-usage telemetry provided by the hosting platform. We do not sell personal data or use it for advertising.",
        ],
      },
      {
        title: "Chrome extension behavior",
        body: [
          "The extension runs only on LeetCode problem pages. It reads the current problem and your recent submission details from LeetCode.",
          "When you submit on a problem that isn't in ankify, the extension adds it, with the statement and your submissions including their source code, unless you turn off \"Collect problems when you submit\" in its settings. You can also add a problem yourself. For problems already in ankify, it syncs new submissions automatically.",
          "Once a day it sends the list of problems you've solved on LeetCode (identifiers only, no code). Your LeetCode cookie never leaves the browser.",
          "When you message the Study Coach on a problem page, a copy of the code in your editor goes with the message and is stored with that conversation, unless you turn off \"Include my code\".",
          "The extension stores its API origin, preferences, and drafts in Chrome local storage. It reuses the ankify web session cookie through credentialed requests and does not store a separate ankify API token.",
        ],
      },
      {
        title: "How data is used and shared",
        body: [
          "Data is used to provide authentication, problem collection, study plans, review scheduling, practice, the Study Coach, history, data export, and account support.",
          "Hosting and database processing may be provided by Vercel and Turso. Google processes OAuth sign-in. When you use AI features, the relevant context (such as the problem, your submissions and code, notes, and replies) is sent to the AI provider whose key you configured (Anthropic, OpenAI, DeepSeek, or a compatible provider), or to the provider ankify uses for free credits if you haven't configured one, under that provider's terms.",
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
    updated: "最后更新：2026 年 10 月 30 日",
    intro:
      "ankify 是用于复习 LeetCode 学习内容的间隔重复服务与 Chrome 扩展。本政策说明我们处理哪些数据以及处理目的。",
    sections: [
      {
        title: "我们处理的数据",
        body: [
          "用于登录的 Google 账号信息：用户 id、姓名、邮箱、头像、会话和账号关联信息。",
          "学习数据：LeetCode 题目信息与题面、提交代码与结果、笔记、解法、易错点、练习记录和你的回答、学习教练对话、复习事件和调度状态，以及早期版本中创建的卡片和测验。",
          "LeetCode 账号数据：你关联的用户名、它的公开资料，以及你做过的题目列表。",
          "配置数据：你的题单、复习设置和加密后的 AI 提供商密钥信封。AI key 会先加密再存储。",
          "托管平台提供的基础运行与页面使用遥测。我们不会出售个人数据，也不会将其用于广告。",
        ],
      },
      {
        title: "Chrome 扩展如何工作",
        body: [
          "扩展只在 LeetCode 题目页运行。它会从 LeetCode 读取当前题目及你的近期提交详情。",
          "你在还没收录的题上提交时，扩展会把这道题连同题面和提交（包括源代码）加入 ankify；可以在扩展设置中关闭「提交后自动收录」。你也可以手动添加题目。对已收录的题，扩展会自动同步新提交。",
          "扩展每天发送一次你在 LeetCode 做过的题目列表（只有题目标识，不含代码）。你的 LeetCode cookie 不会离开浏览器。",
          "你在题目页给学习教练发消息时，编辑器中代码的副本会随消息发送，并随对话保存；可以关闭「附上我的代码」。",
          "扩展会在 Chrome 本地存储 API 地址、偏好和草稿。它通过带凭据请求复用 ankify 网页会话 cookie，不再单独存储 ankify API token。",
        ],
      },
      {
        title: "数据用途与共享",
        body: [
          "数据用于提供登录、题目收录、题单、复习调度、练习、学习教练、历史、数据导出和账号支持。",
          "Vercel 和 Turso 可能分别处理托管与数据库数据；Google 处理 OAuth 登录。使用 AI 功能时，相关上下文（例如题目、你的提交和代码、笔记和回答）会发送给你配置 key 的 AI 提供商（Anthropic、OpenAI、DeepSeek 或兼容提供商）；如果你没有配置，则发送给 ankify 用于免费额度的提供商，并受该提供商条款约束。",
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
