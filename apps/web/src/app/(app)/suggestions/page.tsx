import { EmptyState } from "@/components/ui/empty-state";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { Surface } from "@/components/ui/surface";
import { requirePageUser } from "@/server/auth";
import { isWorkflowEnabled } from "@/server/features";
import { getRequestTranslations } from "@/server/i18n";
import { allocateSuggestion, listSuggestions } from "@/server/suggestions/commands";
import { SuggestionsClient } from "./suggestions-client";

export const dynamic = "force-dynamic";

/** Today's new-problem suggestions: the same items as the extension popup. */
export default async function SuggestionsPage() {
  const user = await requirePageUser();
  const t = await getRequestTranslations();
  const enabled = isWorkflowEnabled("suggestions");
  // The day's suggestion is allocated on its first view (once per local day).
  let list = enabled ? await listSuggestions(user.id) : null;
  let exhausted = false;
  if (list && !list.suggestions.some((suggestion) => suggestion.ordinal === 0)) {
    const daily = await allocateSuggestion(user.id, { requestId: crypto.randomUUID(), kind: "daily" });
    exhausted = daily.ok && daily.response.suggestion === null;
    list = await listSuggestions(user.id);
  }
  return (
    <PageFrame width="standard" className="space-y-6">
      <PageHeader title={t.suggestions.title} description={t.suggestions.subtitle} />
      {list ? (
        <SuggestionsClient initial={list} initialExhausted={exhausted} />
      ) : (
        <Surface>
          <EmptyState title={t.suggestions.unavailable} />
        </Surface>
      )}
    </PageFrame>
  );
}
