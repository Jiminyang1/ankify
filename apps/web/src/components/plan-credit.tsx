import { getTranslations, type Language } from "@/lib/i18n";

type Source = { url: string; credit: "ling" | "neetcode" };

/** Who a plan's problems come from, with a link to the source. No hooks, so
 *  server and client components both use it. */
export function PlanCredit({ source, language, className }: { source: Source; language: Language; className?: string }) {
  const t = getTranslations(language);
  const isLing = source.credit === "ling";
  return (
    <span className={className}>
      {isLing ? t.profile.sourceCredit : t.planMap.credit.neetcode}{" "}
      <a href={source.url} target="_blank" rel="noreferrer" className="underline hover:text-fg">
        {isLing ? t.profile.sourceLink : t.planMap.credit.neetcodeLink}
      </a>
    </span>
  );
}
