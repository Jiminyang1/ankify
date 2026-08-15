"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Actions,
  DockLocation,
  Layout,
  Model,
  type Action,
  type BorderNode,
  type IJsonModel,
  type IJsonTabNode,
  type ITabSetRenderValues,
  type TabNode,
  type TabSetNode,
} from "flexlayout-react";
import { Eye, EyeOff, PanelsTopLeft, RotateCcw } from "lucide-react";

type ReviewPanelId = "question" | "study" | "coach";

type ReviewWorkspaceLabels = {
  layouts: string;
  question: string;
  study: string;
  coach: string;
  show: string;
  hide: string;
  reset: string;
};

export type ReviewWorkspaceLayoutProps = {
  question: ReactNode;
  study: ReactNode;
  coach: ReactNode;
  coachOpen: boolean;
  onCoachOpenChange: (open: boolean) => void;
  labels: ReviewWorkspaceLabels;
};

// v3 resets older nested-tab arrangements so visible panels reopen in their
// default sibling positions after the visual hierarchy cleanup.
const LAYOUT_STORAGE_KEY = "ankify.review.layout.v3";
const DESKTOP_LAYOUT_QUERY = "(min-width: 1024px)";
const PANEL_IDS: ReviewPanelId[] = ["question", "study", "coach"];
const TAB_IDS: Record<ReviewPanelId, string> = {
  question: "review-tab-question",
  study: "review-tab-study",
  coach: "review-tab-coach",
};
const RESTORE_TARGETS: Record<ReviewPanelId, readonly ReviewPanelId[]> = {
  question: ["study", "coach"],
  study: ["question", "coach"],
  coach: ["study", "question"],
};

export function ReviewWorkspaceLayout({
  question,
  study,
  coach,
  coachOpen,
  onCoachOpenChange,
  labels,
}: ReviewWorkspaceLayoutProps) {
  const [initialLayout] = useState(() => loadInitialLayout(labels, coachOpen));
  const [model, setModel] = useState(initialLayout.model);
  const [layoutRevision, remountLayout] = useReducer((revision: number) => revision + 1, 0);
  const [, refreshToolbar] = useReducer((revision: number) => revision + 1, 0);
  const [desktop, setDesktop] = useState(
    () => window.matchMedia(DESKTOP_LAYOUT_QUERY).matches,
  );
  const coachStateReadyRef = useRef(coachOpen === initialLayout.coachOpen);

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_LAYOUT_QUERY);
    const update = (event: MediaQueryListEvent) => setDesktop(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (coachStateReadyRef.current) return;
    if (coachOpen !== initialLayout.coachOpen) {
      onCoachOpenChange(initialLayout.coachOpen);
      return;
    }
    coachStateReadyRef.current = true;
  }, [coachOpen, initialLayout.coachOpen, onCoachOpenChange]);

  const panelVisible = useCallback(
    (panel: ReviewPanelId) => model.getNodeById(TAB_IDS[panel]) !== undefined,
    [model],
  );

  const syncModelState = useCallback(() => {
    refreshToolbar();
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(model.toJson()));
    const nextCoachOpen = panelVisible("coach");
    if (nextCoachOpen !== coachOpen) onCoachOpenChange(nextCoachOpen);
  }, [coachOpen, model, onCoachOpenChange, panelVisible]);

  useEffect(() => {
    model.addChangeListener(syncModelState);
    return () => model.removeChangeListener(syncModelState);
  }, [model, syncModelState]);

  const restorePanel = useCallback((panel: ReviewPanelId) => {
    if (panelVisible(panel)) return;
    const target = RESTORE_TARGETS[panel]
      .map((candidate) => model.getNodeById(TAB_IDS[candidate]))
      .find((node) => node !== undefined)!;
    const location = panel === "question"
      ? DockLocation.LEFT
      : panel === "coach"
        ? DockLocation.RIGHT
        : panelVisible("question")
          ? DockLocation.RIGHT
          : DockLocation.LEFT;
    model.doAction(
      Actions.addTab(panelTab(panel, labels), target.getParent()!.getId(), location, -1, true),
    );
  }, [labels, model, panelVisible]);

  const hidePanel = useCallback((panel: ReviewPanelId) => {
    if (!panelVisible(panel)) return;
    const visibleCount = PANEL_IDS.filter(panelVisible).length;
    if (visibleCount === 1) return;
    model.doAction(Actions.deleteTab(TAB_IDS[panel]));
  }, [model, panelVisible]);

  useEffect(() => {
    if (!coachStateReadyRef.current) return;
    if (coachOpen) restorePanel("coach");
    else hidePanel("coach");
  }, [coachOpen, hidePanel, restorePanel]);

  useEffect(() => {
    for (const panel of PANEL_IDS) {
      const node = model.getNodeById(TAB_IDS[panel]) as TabNode | undefined;
      if (node && node.getName() !== labels[panel]) {
        model.doAction(Actions.renameTab(node.getId(), labels[panel]));
      }
    }
  }, [labels, model]);

  const onAction = useCallback((action: Action) => {
    if (
      action.type === Actions.DELETE_TAB &&
      PANEL_IDS.filter(panelVisible).length === 1 &&
      PANEL_IDS.some((panel) => TAB_IDS[panel] === action.data.node)
    ) {
      return undefined;
    }
    return action;
  }, [panelVisible]);

  const togglePanel = useCallback((panel: ReviewPanelId) => {
    const visible = panelVisible(panel);
    if (panel === "coach") {
      onCoachOpenChange(!visible);
    } else if (visible) {
      hidePanel(panel);
    } else {
      restorePanel(panel);
    }
  }, [hidePanel, onCoachOpenChange, panelVisible, restorePanel]);

  const resetLayout = useCallback(() => {
    const nextModel = createModel(labels, coachOpen);
    setModel(nextModel);
    remountLayout();
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    refreshToolbar();
  }, [coachOpen, labels]);

  const factory = useCallback((node: TabNode) => {
    const component = node.getComponent() as ReviewPanelId;
    const content = component === "question" ? question : component === "study" ? study : coach;
    return <div className="h-full min-h-0 min-w-0 overflow-hidden">{content}</div>;
  }, [coach, question, study]);

  const visibleCount = PANEL_IDS.filter(panelVisible).length;
  const layoutMenu = useMemo(() => (
    <LayoutMenu
      key="review-layout-menu"
      labels={labels}
      panelVisible={panelVisible}
      visibleCount={visibleCount}
      onTogglePanel={togglePanel}
      onReset={resetLayout}
    />
  ), [labels, panelVisible, resetLayout, togglePanel, visibleCount]);

  const onRenderTabSet = useCallback((node: TabSetNode | BorderNode, values: ITabSetRenderValues) => {
    const owner = panelVisible("coach")
      ? "coach"
      : panelVisible("study")
        ? "study"
        : "question";
    const ownerTabSetId = model.getNodeById(TAB_IDS[owner])?.getParent()?.getId();
    if (node.getId() === ownerTabSetId) values.buttons.unshift(layoutMenu);
  }, [layoutMenu, model, panelVisible]);

  if (!desktop) {
    return (
      <div className="relative space-y-4">
        <div className="fixed bottom-5 left-5 z-40 rounded-lg border border-border bg-surface p-1 shadow-card">
          {layoutMenu}
        </div>
        {panelVisible("question") && question}
        {panelVisible("study") && study}
        {panelVisible("coach") && <div className="h-[min(42rem,calc(100dvh-6rem))] overflow-hidden rounded-xl border border-border">{coach}</div>}
      </div>
    );
  }

  return (
    <div className="h-[calc(100dvh-85px)] min-h-[620px]">
      <div className="ankify-review-layout flexlayout__theme_dark relative h-full min-h-0 overflow-hidden rounded-xl border border-border bg-bg">
        <Layout
          key={layoutRevision}
          model={model}
          factory={factory}
          onAction={onAction}
          onRenderTabSet={onRenderTabSet}
          realtimeResize
          supportsPopout={false}
        />
      </div>
    </div>
  );
}

function LayoutMenu({
  labels,
  panelVisible,
  visibleCount,
  onTogglePanel,
  onReset,
}: {
  labels: ReviewWorkspaceLabels;
  panelVisible: (panel: ReviewPanelId) => boolean;
  visibleCount: number;
  onTogglePanel: (panel: ReviewPanelId) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const toggleMenu = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current!.getBoundingClientRect();
    const horizontal = rect.right >= 224
      ? { right: Math.max(8, window.innerWidth - rect.right) }
      : { left: Math.max(8, rect.left) };
    const vertical = window.innerHeight - rect.bottom >= 232
      ? { top: rect.bottom + 8 }
      : { bottom: window.innerHeight - rect.top + 8 };
    setPosition({ ...horizontal, ...vertical });
    setOpen(true);
  };

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleMenu}
        aria-label={labels.layouts}
        aria-expanded={open}
        aria-haspopup="menu"
        title={labels.layouts}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted transition hover:border-border hover:bg-subtle hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <PanelsTopLeft className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={labels.layouts}
          style={position}
          className="fixed z-50 w-52 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-card-hover"
        >
          <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            {labels.layouts}
          </div>
          {PANEL_IDS.map((panel) => {
            const visible = panelVisible(panel);
            return (
              <button
                key={panel}
                type="button"
                role="menuitem"
                onClick={() => onTogglePanel(panel)}
                disabled={visible && visibleCount === 1}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-xs text-fg transition hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span>{labels[panel]}</span>
                <span className="inline-flex items-center gap-1.5 text-muted">
                  {visible ? labels.hide : labels.show}
                  {visible ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                </span>
              </button>
            );
          })}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onReset();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-muted transition hover:bg-subtle hover:text-fg"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {labels.reset}
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

function loadInitialLayout(labels: ReviewWorkspaceLabels, coachOpen: boolean) {
  const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
  if (!saved) return createReviewWorkspaceModel(null, labels, coachOpen);

  try {
    return createReviewWorkspaceModel(JSON.parse(saved) as IJsonModel, labels, coachOpen);
  } catch {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    return createReviewWorkspaceModel(null, labels, coachOpen);
  }
}

export function createReviewWorkspaceModel(
  saved: IJsonModel | null,
  labels: ReviewWorkspaceLabels,
  coachOpen: boolean,
) {
  const model = saved ? Model.fromJson(saved) : createModel(labels, coachOpen);
  model.setSplitterSize(10);
  return {
    model,
    coachOpen: model.getNodeById(TAB_IDS.coach) !== undefined,
  };
}

function createModel(labels: ReviewWorkspaceLabels, includeCoach: boolean) {
  const panels: ReviewPanelId[] = includeCoach
    ? ["question", "study", "coach"]
    : ["question", "study"];
  const model = Model.fromJson({
    global: {
      enableEdgeDock: true,
      tabEnableClose: true,
      tabEnableRename: false,
      tabEnablePopout: false,
      tabSetEnableCloseButton: false,
      tabSetEnableDeleteWhenEmpty: true,
      tabSetEnableMaximize: true,
      tabSetMinWidth: 280,
    },
    borders: [],
    layout: {
      type: "row",
      id: "review-root",
      weight: 100,
      children: panels.map((panel) => ({
        type: "tabset",
        id: `review-tabset-${panel}`,
        weight: panel === "question" ? 38 : panel === "study" ? 38 : 24,
        minWidth: panel === "coach" ? 300 : 340,
        children: [panelTab(panel, labels)],
      })),
    },
  });
  return model;
}

function panelTab(panel: ReviewPanelId, labels: ReviewWorkspaceLabels): IJsonTabNode {
  return {
    type: "tab",
    id: TAB_IDS[panel],
    name: labels[panel],
    component: panel,
    minWidth: panel === "coach" ? 300 : 340,
    enableClose: true,
    enableDrag: true,
    enableRename: false,
  };
}
