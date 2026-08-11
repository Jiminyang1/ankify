"use client";

import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { AgentPageContext } from "@ankify/contracts";
import { Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/components/LanguageProvider";
import { AgentSidebar } from "./agent-sidebar";

export type AgentClientContext = AgentPageContext & {
  problemTitle?: string;
  contextLabel?: string;
};

const AgentShellContext = createContext<{
  pageContext: AgentClientContext | null;
  setPageContext: React.Dispatch<React.SetStateAction<AgentClientContext | null>>;
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  embeddedPanel: boolean;
  setEmbeddedPanel: React.Dispatch<React.SetStateAction<boolean>>;
} | null>(null);

export function AgentShell({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const [registeredContext, setPageContext] = useState<AgentClientContext | null>(null);
  const [open, setOpen] = useState(false);
  const [embeddedPanel, setEmbeddedPanel] = useState(false);
  const [panelWidth, setPanelWidth] = useState(380);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const globalContext = useMemo<AgentClientContext>(() => {
    if (pathname.startsWith("/review")) {
      return { page: "review", activePanel: "overview", problemId: null, contextLabel: t.nav.review };
    }
    if (pathname.startsWith("/problems/")) {
      return { page: "problem", activePanel: "overview", problemId: null, contextLabel: t.nav.problems };
    }
    if (pathname.startsWith("/problems")) {
      return { page: "problems", activePanel: "overview", problemId: null, contextLabel: t.nav.problems };
    }
    if (pathname.startsWith("/analysis")) {
      return { page: "analysis", activePanel: "overview", problemId: null, contextLabel: t.nav.analysis };
    }
    if (pathname.startsWith("/settings")) {
      return { page: "settings", activePanel: "overview", problemId: null, contextLabel: t.nav.settings };
    }
    if (pathname.startsWith("/extension-connected")) {
      return { page: "extension", activePanel: "overview", problemId: null, contextLabel: "Extension" };
    }
    return { page: "today", activePanel: "overview", problemId: null, contextLabel: t.nav.today };
  }, [pathname, t.nav]);
  const pageContext = registeredContext ?? globalContext;
  const value = useMemo(
    () => ({ pageContext, setPageContext, open, setOpen, embeddedPanel, setEmbeddedPanel }),
    [embeddedPanel, open, pageContext],
  );
  const outerPanelOpen = open && !embeddedPanel;

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const resizePanel = useCallback((clientX: number) => {
    const bounds = shellRef.current!.getBoundingClientRect();
    const maxWidth = Math.min(560, Math.max(280, bounds.width - 480));
    setPanelWidth(Math.min(maxWidth, Math.max(280, bounds.right - clientX)));
  }, []);

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizePanel(event.clientX);

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const handleMove = (moveEvent: PointerEvent) => resizePanel(moveEvent.clientX);
    const stop = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop, { once: true });
  }, [resizePanel]);

  const resizeWithKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const bounds = shellRef.current!.getBoundingClientRect();
    const maxWidth = Math.min(560, Math.max(280, bounds.width - 480));
    const delta = event.key === "ArrowLeft" ? 24 : -24;
    setPanelWidth((current) => Math.min(maxWidth, Math.max(280, current + delta)));
  }, []);

  return (
    <AgentShellContext.Provider value={value}>
      <div
        ref={shellRef}
        className={cn(
          "relative grid min-h-[calc(100dvh-94px)] grid-cols-1 sm:min-h-[calc(100dvh-61px)] md:transition-[grid-template-columns] md:duration-200 motion-reduce:transition-none",
          outerPanelOpen
            ? "md:grid-cols-[minmax(0,1fr)_20px_var(--agent-panel-width)]"
            : "md:grid-cols-[minmax(0,1fr)_0px_0px]",
        )}
        style={{ "--agent-panel-width": `${panelWidth}px` } as CSSProperties}
      >
        <main className={cn(
          "mx-auto w-full min-w-0",
          pathname.startsWith("/review") ? "max-w-none px-3 py-3" : "max-w-7xl px-6 py-8",
        )}>
          {children}
        </main>

        <div
          role="separator"
          aria-label="Resize Study Coach"
          aria-orientation="vertical"
          tabIndex={outerPanelOpen ? 0 : -1}
          onPointerDown={startResize}
          onKeyDown={resizeWithKeyboard}
          className={cn(
            "group hidden cursor-col-resize items-stretch justify-center px-2 outline-none md:flex",
            !outerPanelOpen && "pointer-events-none invisible",
          )}
        >
          <div className="my-8 w-px rounded-full bg-border transition group-hover:bg-accent group-focus-visible:bg-accent" />
        </div>

        {!embeddedPanel && (
          <AgentSidebar
            open={open}
            onClose={() => setOpen(false)}
            pageContext={pageContext}
          />
        )}
      </div>

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex h-11 items-center gap-2 rounded-full border border-accent/35 bg-surface px-4 text-sm font-medium text-fg shadow-card-hover transition hover:border-accent/60 hover:bg-subtle sm:bottom-6 sm:right-6"
          aria-label={t.agent.open}
        >
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          <span>{t.agent.title}</span>
        </button>
      )}
    </AgentShellContext.Provider>
  );
}

export function useAgentPageContext(context: AgentClientContext | null) {
  const shell = useContext(AgentShellContext);
  if (!shell) throw new Error("useAgentPageContext must be used inside AgentShell");
  const setPageContext = shell.setPageContext;
  const problemId = context?.problemId;
  const problemTitle = context?.problemTitle;
  const page = context?.page;
  const activePanel = context?.activePanel;

  useEffect(() => {
    const next =
      problemId && problemTitle && page && activePanel
        ? { problemId, problemTitle, page, activePanel }
        : null;
    setPageContext(next);
    return () => {
      setPageContext((current) =>
        current?.problemId === problemId ? null : current,
      );
    };
  }, [activePanel, page, problemId, problemTitle, setPageContext]);
}

export function useAgentShellControls() {
  const shell = useContext(AgentShellContext);
  if (!shell) throw new Error("useAgentShellControls must be used inside AgentShell");
  return { open: shell.open, setOpen: shell.setOpen };
}

export function useEmbeddedAgentPanel(enabled: boolean) {
  const shell = useContext(AgentShellContext);
  if (!shell) throw new Error("useEmbeddedAgentPanel must be used inside AgentShell");
  const setEmbeddedPanel = shell.setEmbeddedPanel;

  useEffect(() => {
    setEmbeddedPanel(enabled);
    return () => setEmbeddedPanel(false);
  }, [enabled, setEmbeddedPanel]);
}
