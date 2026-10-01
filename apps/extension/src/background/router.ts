import type { CapabilitiesDto, CaptureResultDto, ReviewOverviewDto } from "@ankify/contracts";
import type { ContentMessage, PageMessage, SenderContext } from "../shared/protocol";
import type { AccountStateApi } from "./account";
import type { AnalysisClient } from "./analysis";
import type { ApiClient, ApiResult } from "./api";
import type { SessionController } from "./sessions";
import type { SuggestionsClient } from "./suggestions";

export type TabsApi = {
  /** An open tab already showing the problem, if any. */
  findProblemTab(slug: string): Promise<number | null>;
  open(slug: string): Promise<number>;
  focus(tabId: number): Promise<void>;
};

/** A failed API call as the popup and panel see it: auth, outage, overload,
 *  and a server decision are told apart, never all called "offline". */
export function apiFailure(result: Extract<ApiResult<unknown>, { ok: false }>) {
  switch (result.kind) {
    case "auth":
      return { ok: false as const, error: "signed_out" };
    case "network":
      return { ok: false as const, error: "offline" };
    case "rate_limited":
      return { ok: false as const, error: "rate_limited" };
    case "server":
      return { ok: false as const, error: "server_error" };
    case "rejected":
      return { ok: false as const, error: result.code ?? "unexpected" };
  }
}

type ParsedMessage =
  | { channel: "content"; message: ContentMessage }
  | { channel: "page"; message: PageMessage };

/** Maps validated messages onto the session controller. */
export function createRouter(deps: {
  controller: SessionController;
  analysis: AnalysisClient;
  account: AccountStateApi;
  api: ApiClient;
  tabs: TabsApi;
  suggestions: SuggestionsClient;
  tokens: { bind(tabId: number, token: string): Promise<void>; tokenFor(tabId: number): Promise<string> };
  newId: () => string;
  settings: () => Promise<{ language: "en" | "zh" }>;
  /** Called with every overview the popup loads (the toolbar badge shows its due count). */
  onOverview?: (overview: ReviewOverviewDto) => void;
}) {
  const { controller, tabs } = deps;

  async function handleContent(message: ContentMessage, tabId: number) {
    switch (message.type) {
      case "page_state":
        return controller.pageState(tabId, message.slug);
      case "panel_settings":
        return { ok: true, response: { language: (await deps.settings()).language } };
      case "import_history": {
        // Existing problems only refresh metadata and gain submissions; the
        // legacy capture route never rewrites their schedule.
        const result = await deps.api.request<CaptureResultDto>("/api/capture", { body: { ...message.problem, submissions: message.submissions } });
        return result.ok ? { ok: true, response: result.data } : apiFailure(result);
      }
      case "session_start":
        return controller.start(
          { tabId },
          {
            target: { kind: "leetcode", problem: message.problem },
            mode: message.mode,
            ...(message.baseline ? { baseline: message.baseline } : {}),
            ...(message.sourceAccount ? { sourceAccount: message.sourceAccount } : {}),
            supersedePendingRating: message.supersedePendingRating,
          },
        );
      case "session_control":
        return controller.control({ tabId }, message.sessionId, message.control);
      case "session_activity":
        return controller.activity(tabId, message.sessionId, { activeMs: message.activeMs, observedMs: message.observedMs }, message.availability);
      case "session_observations":
        return controller.observations(message.sessionId, message.observations);
      case "session_rating":
        return controller.rate(message.sessionId, message.rating);
      case "session_rating_decision":
        return controller.skipRating(message.sessionId);
      case "analysis_state":
        return deps.analysis.state(message.sessionId);
      case "analysis_start":
        return deps.analysis.start(message.sessionId);
      case "analysis_finding":
        return deps.analysis.decide(message.mistakeId, message.decision, message.category);
    }
  }

  async function openProblem(slug: string) {
    const tabId = (await tabs.findProblemTab(slug)) ?? (await tabs.open(slug));
    await tabs.focus(tabId);
    return tabId;
  }

  async function handlePage(message: PageMessage) {
    switch (message.type) {
      case "auth_status": {
        const state = await deps.account.current({ fresh: true });
        if (state.kind === "signed_in") {
          // Onboarding records that the extension is connected (idempotent).
          void deps.api.request("/api/onboarding", { body: { action: "extension_connected" } }).catch(() => undefined);
          return { kind: "signed_in", user: state.user };
        }
        return { kind: state.kind };
      }
      case "overview": {
        // Opening the popup is a moment to sync: what waits is sent now.
        await controller.resumeSync().catch(() => null);
        const result = await controller.overview();
        if (result.ok) deps.onOverview?.(result.response);
        return result;
      }
      case "capabilities": {
        const result = await deps.api.request<CapabilitiesDto>("/api/capabilities");
        return result.ok ? { ok: true, response: result.data } : apiFailure(result);
      }
      case "open_review": {
        // The session exists before navigation: a problem tab that is already
        // open starts it with its own token; otherwise a token minted now is
        // bound to the tab once it opens.
        const existing = await tabs.findProblemTab(message.slug);
        const target = { kind: "problem" as const, problemId: message.problemId };
        const input = { target, mode: "due_review" as const, supersedePendingRating: message.supersedePendingRating };
        if (existing != null) {
          const result = await controller.start({ tabId: existing }, input);
          if (result.ok) await tabs.focus(existing);
          return result;
        }
        const ownerToken = deps.newId();
        const result = await controller.start({ ownerToken }, input);
        if (result.ok) {
          const tabId = await tabs.open(message.slug);
          await deps.tokens.bind(tabId, ownerToken);
          await tabs.focus(tabId);
        }
        return result;
      }
      case "open_problem":
        await openProblem(message.slug);
        return { ok: true };
      case "suggestions":
        return deps.suggestions.today();
      case "suggestion_extra":
        return deps.suggestions.extra();
      case "suggestion_action":
        return deps.suggestions.act(message.suggestionId, message.action);
      case "suggestion_start": {
        // Like a due review: an open tab of the problem controls the session
        // with its own token; a new tab is bound to a token minted now.
        const existing = await tabs.findProblemTab(message.slug);
        const ownerToken = existing != null ? await deps.tokens.tokenFor(existing) : deps.newId();
        const result = await deps.suggestions.start(message.suggestionId, ownerToken);
        if (!result.ok) return result;
        if (existing != null) {
          await tabs.focus(existing);
          return result;
        }
        const tabId = await tabs.open(message.slug);
        await deps.tokens.bind(tabId, ownerToken);
        await tabs.focus(tabId);
        return result;
      }
      case "session_control":
        // Only a tab controls an active session; the popup may end one no tab
        // holds. Resuming happens on the problem page.
        if (message.control.command !== "finish" && message.control.command !== "abandon") {
          return { ok: false, error: "unexpected" };
        }
        return controller.control({ popup: true }, message.sessionId, message.control);
      case "session_rating":
        return controller.rate(message.sessionId, message.rating);
      case "session_rating_decision":
        return controller.skipRating(message.sessionId);
      case "sync_status":
        return controller.syncStatus();
      case "sync_retry":
        await controller.retryBlocked();
        await controller.flush();
        return controller.syncStatus();
      case "notes_load": {
        const result = await deps.api.request<{ problem: { id: string; title: string; notes: string | null } }>(
          `/api/problems/by-slug/${encodeURIComponent(message.slug)}`,
        );
        if (result.ok) return { ok: true, response: { problemId: result.data.problem.id, title: result.data.problem.title, notes: result.data.problem.notes ?? "" } };
        if (result.status === 404) return { ok: true, response: null };
        return apiFailure(result);
      }
      case "notes_save": {
        const result = await deps.api.request(`/api/problems/${encodeURIComponent(message.problemId)}`, {
          method: "PATCH",
          body: { notes: message.notes },
        });
        return result.ok ? { ok: true, response: null } : apiFailure(result);
      }
    }
  }

  return {
    handle(parsed: ParsedMessage, sender: SenderContext) {
      if (parsed.channel === "content" && sender.kind === "content") return handleContent(parsed.message, sender.tabId);
      if (parsed.channel === "page" && sender.kind === "page") return handlePage(parsed.message);
      return Promise.resolve({ ok: false, error: "unexpected" });
    },
  };
}
