import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { requirePageUser } from "@/server/auth";
import { getRequestLanguage } from "@/server/i18n";
import { Surface } from "@/components/ui/surface";

export const dynamic = "force-dynamic";

const copy = {
  en: {
    title: "Extension connected",
    body: "Your Google session is ready in the ankify extension. You can close this tab and return to LeetCode.",
    continue: "Open ankify",
  },
  zh: {
    title: "扩展已连接",
    body: "Google 登录会话已同步到 ankify 扩展。你可以关闭此页面并返回 LeetCode。",
    continue: "打开 ankify",
  },
} as const;

export default async function ExtensionConnectedPage() {
  await requirePageUser();
  const language = await getRequestLanguage();
  const t = copy[language];

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center">
      <Surface className="w-full p-7 text-center">
        <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold">{t.title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{t.body}</p>
        <Link
          href="/today"
          className="mt-5 inline-flex rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast"
        >
          {t.continue}
        </Link>
      </Surface>
    </div>
  );
}
