import type { CapabilitiesDto, CaptureResultDto, ReviewOverviewDto } from "@ankify/contracts";
import type { ContentMessage, PageMessage, SenderContext } from "../shared/protocol";
import type { AccountStateApi } from "./account";
import type { ApiClient } from "./api";
import type { SessionController } from "./sessions";

export type TabsApi = {
  /** An open tab already showing the problem, if any. */
  findProblemTab(slug: string): Promise<number | null>;
  open(slug: string): Promise<number>;
  focus(tabId: number): Promise<void>;
};

type ParsedMessage =
  | { channel: "content"; message: ContentMessage }
  | { channel: "page"; message: PageMessage };

/** Maps validated messages onto the session controller. */
export function createRouter(deps: {
  controller: SessionController;
  account: AccountStateApi;
  api: ApiClient;
  tabs: TabsApi;
  tokens: { bind(tabId: number, token: string): Promise<void> };
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
        if (result.ok) return { ok: true, response: result.data };
        return { ok: false, error: result.kind === "auth" ? "signed_out" : result.kind === "rejected" ? (result.code ?? "unexpected") : "offline" };
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
        return controller.ratingDecision(message.sessionId, message.decision);
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
        await controller.flush().catch(() => null);
        const result = await controller.overview();
        if (result.ok) deps.onOverview?.(result.response);
        return result;
      }
      case "capabilities": {
        const result = await deps.api.request<CapabilitiesDto>("/api/capabilities");
        return result.ok ? { ok: true, response: result.data } : { ok: false, error: result.kind === "auth" ? "signed_out" : "offline" };
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
        return controller.ratingDecision(message.sessionId, message.decision);
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
        return { ok: false, error: result.kind === "auth" ? "signed_out" : "offline" };
      }
      case "notes_save": {
        const result = await deps.api.request(`/api/problems/${encodeURIComponent(message.problemId)}`, {
          method: "PATCH",
          body: { notes: message.notes },
        });
        return result.ok ? { ok: true, response: null } : { ok: false, error: result.kind === "auth" ? "signed_out" : "offline" };
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
