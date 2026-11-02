import { PageFrame, PageHeader } from "@/components/ui/page";
import { PlanCredit } from "@/components/plan-credit";
import { requirePageUser } from "@/server/auth";
import { getRequestLanguage, getRequestTranslations } from "@/server/i18n";
import { loadPlanMeters } from "@/server/plan-map";
import { getCurrentStudyPlan, studyPlanSource } from "@/server/study-plans";
import { PlanListView } from "./list-view";
import { parsePlanView } from "./plan-map-model";
import { PlanMeters } from "./plan-meters";
import { PlanPicker } from "./plan-picker";
import { PlanTab } from "./plan-tab";
import { PlanViewTabs } from "./plan-view-tabs";
import { PlanRouteView } from "./route-view";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ chapter?: string | string[]; view?: string | string[] }>;
}) {
  const user = await requirePageUser();
  // The problem page links a chapter here so its dialog opens.
  const { chapter, view: viewParam } = await searchParams;
  const view = parsePlanView(viewParam);
  const language = await getRequestLanguage();
  const [t, current, meters] = await Promise.all([
    getRequestTranslations(),
    getCurrentStudyPlan(user.id, language),
    loadPlanMeters(user.id, language),
  ]);
  const source = studyPlanSource(current.plan.slug);

  return (
    <PageFrame width="wide" className="space-y-6">
      <PageHeader
        title={t.profile.title}
        description={
          <>
            {t.profile.subtitle(current.plan.name)}
            {source && <PlanCredit source={source} language={language} className="mt-1 block text-xs" />}
          </>
        }
        actions={
          <PlanPicker plans={current.options} current={{ slug: current.plan.slug, custom: current.custom }} />
        }
      />

      <PlanMeters meters={meters} language={language} />

      <PlanViewTabs view={view} />

      <div role="tabpanel" aria-labelledby={`tab-${view}`} className="space-y-6">
        {view === "list" ? (
          <PlanListView currentPlan={current.plan.slug} />
        ) : view === "route" ? (
          <PlanRouteView />
        ) : (
          <PlanTab
            userId={user.id}
            language={language}
            chapter={typeof chapter === "string" ? chapter : null}
            t={t}
          />
        )}
      </div>
    </PageFrame>
  );
}
