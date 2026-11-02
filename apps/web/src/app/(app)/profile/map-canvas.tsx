"use client";

import type { PlanStatusEntryDto } from "@ankify/contracts";
import { LocateFixed, Maximize, Minimize, Minus, Plus, Scan } from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Ref,
} from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { PlanMapBranchNode, PlanMapProblemNode } from "./map-node";
import {
  centerPlanMapView,
  clampPlanMapView,
  clampPlanMapZoom,
  fitPlanMapView,
  planMapInWindow,
  planMapSeen,
  rootPlanMapView,
  zoomPlanMapAt,
  type PlanMapCount,
  type PlanMapLayout,
  type PlanMapNode,
  type PlanMapSize,
  type PlanMapView,
  type PlanMapWindow,
} from "./plan-map-layout";
import { PLAN_STORAGE, writeStored } from "./plan-storage";

/** Rendered beyond the viewport on each side, in viewports. Panning this far
 *  moves already-drawn nodes, without touching React. */
const MARGIN = 0.6;
/** Redraw before the edge of what's drawn comes into view. */
const SLACK = 0.25;
const DOT_SPACING = 22;
const KEY_STEP = 60;
const ZOOM_STEP = 1.2;
const DRAG_THRESHOLD = 5;

type CanvasAction =
  | { type: "root" }
  | { type: "node"; id: string }
  /** Keep a node where it is on screen while the map moves around it. */
  | { type: "anchor"; id: string; x: number; y: number };

export type PlanMapCanvasHandle = {
  /** Runs once the next layout is in place. */
  queue: (action: CanvasAction) => void;
  /** The node about to be opened or closed stays put. */
  anchor: (entry: PlanMapNode) => void;
};

const NO_NODES: { nodes: PlanMapNode[]; edges: string } = { nodes: [], edges: "" };

function needsRedraw(seen: PlanMapWindow, drawn: PlanMapWindow | null): boolean {
  if (!drawn) return true;
  const slackX = seen.w * SLACK;
  const slackY = seen.h * SLACK;
  const stillCovered =
    seen.x - drawn.x >= slackX &&
    seen.y - drawn.y >= slackY &&
    drawn.x + drawn.w - (seen.x + seen.w) >= slackX &&
    drawn.y + drawn.h - (seen.y + seen.h) >= slackY;
  // Zoomed in a lot since: most of what's drawn is far off screen.
  const wasteful = drawn.w * drawn.h > seen.w * seen.h * (1 + 2 * MARGIN) ** 2 * 2.5;
  return !stillCovered || wasteful;
}

export function PlanMapCanvas({
  layout,
  counts,
  statuses,
  hits,
  initialZoom,
  handleRef,
}: {
  layout: PlanMapLayout;
  counts: ReadonlyMap<string, PlanMapCount>;
  statuses: Readonly<Record<string, PlanStatusEntryDto>>;
  hits: ReadonlySet<string>;
  initialZoom: number;
  handleRef: Ref<PlanMapCanvasHandle>;
}) {
  const { t } = useLanguage();
  const copy = t.planMap.map;
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const percentRef = useRef<HTMLSpanElement>(null);
  // Moving never renders: the view lives here and goes straight to the DOM.
  const view = useRef<PlanMapView>({ z: clampPlanMapZoom(initialZoom), tx: 0, ty: 0 });
  const layoutRef = useRef(layout);
  const appliedLayout = useRef<PlanMapLayout | null>(null);
  const pending = useRef<CanvasAction | null>({ type: "root" });
  const drawn = useRef<PlanMapWindow | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [drawnWindow, setDrawnWindow] = useState<PlanMapWindow | null>(null);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen] = useState(() => document.fullscreenEnabled);

  const size = useCallback((): PlanMapSize => {
    const viewport = viewportRef.current;
    return { w: viewport?.clientWidth ?? 0, h: viewport?.clientHeight ?? 0 };
  }, []);

  const syncWindow = useCallback(
    (urgent: boolean) => {
      const current = size();
      if (!current.w || !current.h) return;
      const seen = planMapSeen(view.current, current);
      if (!needsRedraw(seen, drawn.current)) return;
      const marginX = seen.w * MARGIN;
      const marginY = seen.h * MARGIN;
      const next = { x: seen.x - marginX, y: seen.y - marginY, w: seen.w + 2 * marginX, h: seen.h + 2 * marginY };
      drawn.current = next;
      // While moving, the view keeps going and new nodes catch up behind it.
      if (urgent) setDrawnWindow(next);
      else startTransition(() => setDrawnWindow(next));
    },
    [size],
  );

  const apply = useCallback(
    (next: PlanMapView, urgent = false) => {
      const viewport = viewportRef.current;
      const canvas = canvasRef.current;
      if (!viewport || !canvas) return;
      const clamped = clampPlanMapView(next, size(), layoutRef.current);
      view.current = clamped;
      // Whole device pixels, so settled text isn't drawn on half pixels.
      const ratio = window.devicePixelRatio || 1;
      const x = Math.round(clamped.tx * ratio) / ratio;
      const y = Math.round(clamped.ty * ratio) / ratio;
      canvas.style.transform = `translate(${x}px, ${y}px) scale(${clamped.z})`;
      // Only while moving: the browser reuses a bitmap for smooth motion, then
      // redraws text sharply at the new scale once this comes off.
      canvas.style.willChange = "transform";
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        canvas.style.willChange = "";
        writeStored(PLAN_STORAGE.mapZoom, Math.round(view.current.z * 1000) / 1000);
      }, 150);
      viewport.style.backgroundPosition = `${x}px ${y}px`;
      // Far out, every dot would be a grey wash, so draw one in four.
      const dots = DOT_SPACING * clamped.z * (clamped.z < 0.5 ? 4 : 1);
      viewport.style.backgroundSize = `${dots}px ${dots}px`;
      if (percentRef.current) percentRef.current.textContent = `${Math.round(clamped.z * 100)}%`;
      syncWindow(urgent);
    },
    [size, syncWindow],
  );

  useImperativeHandle(
    handleRef,
    () => ({
      queue: (action) => {
        pending.current = action;
        rerender();
      },
      anchor: (entry) => {
        pending.current = { type: "anchor", id: entry.id, x: entry.x, y: entry.y };
      },
    }),
    [],
  );

  // Runs before paint, so a change of layout and the move that goes with it
  // land together.
  useLayoutEffect(() => {
    const action = pending.current;
    if (!action && appliedLayout.current === layout) return;
    pending.current = null;
    layoutRef.current = layout;
    appliedLayout.current = layout;
    const current = view.current;
    const area = size();
    let next = current;
    const find = (id: string) => {
      const position = layout.positions.get(id);
      return position == null ? undefined : layout.nodes[position];
    };
    if (action?.type === "root") {
      next = rootPlanMapView(current.z, area, layout.nodes[0]!);
    } else if (action?.type === "node") {
      const target = find(action.id);
      if (target) next = centerPlanMapView(current.z, area, target);
      // The frame can start below the fold, and the hit is in its middle.
      viewportRef.current?.scrollIntoView({ block: "nearest" });
    } else if (action?.type === "anchor") {
      const target = find(action.id);
      if (target) {
        next = { z: current.z, tx: current.tx - (target.x - action.x) * current.z, ty: current.ty - (target.y - action.y) * current.z };
      }
    }
    apply(next, true);
  });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { x0: number; y0: number; tx0: number; ty0: number; moved: boolean } | null = null;
    let pinch: { distance: number; z: number; worldX: number; worldY: number } | null = null;
    let swallowClick = false;
    let gesture: { z: number } | null = null;

    const local = (clientX: number, clientY: number) => {
      const rect = viewport.getBoundingClientRect();
      return [clientX - rect.left, clientY - rect.top] as const;
    };
    const twoPointers = () => {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      return { a, b, distance: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    };
    const inControls = (target: EventTarget | null) => (target as Element | null)?.closest?.("[data-map-controls]") != null;

    const onPointerDown = (event: PointerEvent) => {
      swallowClick = false;
      if (inControls(event.target)) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        drag = { x0: event.clientX, y0: event.clientY, tx0: view.current.tx, ty0: view.current.ty, moved: false };
      } else if (pointers.size === 2) {
        const { a, b, distance } = twoPointers();
        const [mx, my] = local((a.x + b.x) / 2, (a.y + b.y) / 2);
        const { z, tx, ty } = view.current;
        pinch = { distance, z, worldX: (mx - tx) / z, worldY: (my - ty) / z };
        drag = null;
        swallowClick = true;
        try {
          viewport.setPointerCapture(event.pointerId);
        } catch {
          // The pointer may already be gone.
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && pointers.size >= 2) {
        const { a, b, distance } = twoPointers();
        const [mx, my] = local((a.x + b.x) / 2, (a.y + b.y) / 2);
        const z = clampPlanMapZoom((pinch.z * distance) / pinch.distance);
        apply({ z, tx: mx - pinch.worldX * z, ty: my - pinch.worldY * z });
        return;
      }
      if (!drag) return;
      const dx = event.clientX - drag.x0;
      const dy = event.clientY - drag.y0;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.moved = true;
        viewport.dataset.panning = "true";
        try {
          viewport.setPointerCapture(event.pointerId);
        } catch {
          // The pointer may already be gone.
        }
      }
      apply({ ...view.current, tx: drag.tx0 + dx, ty: drag.ty0 + dy });
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (drag?.moved) swallowClick = true;
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        // One finger of a pinch lifted: keep panning with the other.
        const [rest] = [...pointers.values()] as [{ x: number; y: number }];
        drag = { x0: rest.x, y0: rest.y, tx0: view.current.tx, ty0: view.current.ty, moved: true };
      }
      if (pointers.size === 0) {
        drag = null;
        delete viewport.dataset.panning;
      }
    };

    // Touch starts captured by the touched node. Moving that capture to the
    // frame fires this on the node, which bubbles here and must not end the gesture.
    const onLostCapture = (event: PointerEvent) => {
      if (event.target === viewport) onPointerEnd(event);
    };

    // A drag isn't a click on whatever it ended over. Keyboard clicks have no
    // pointer behind them, so they always go through.
    const onClickCapture = (event: MouseEvent) => {
      if (swallowClick && event.detail !== 0) {
        event.preventDefault();
        event.stopPropagation();
      }
      swallowClick = false;
    };

    const preventDrag = (event: Event) => event.preventDefault();

    const onWheel = (event: WheelEvent) => {
      if (inControls(event.target)) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        // A trackpad pinch arrives as ctrl + wheel.
        const delta = Math.max(-60, Math.min(60, event.deltaY * unit));
        const [cx, cy] = local(event.clientX, event.clientY);
        apply(zoomPlanMapAt(view.current, view.current.z * Math.exp(-delta * 0.01), cx, cy));
        return;
      }
      const sideways = event.shiftKey && !event.deltaX;
      apply({
        ...view.current,
        tx: view.current.tx - (sideways ? event.deltaY : event.deltaX) * unit,
        ty: view.current.ty - (sideways ? 0 : event.deltaY) * unit,
      });
    };

    // Safari's trackpad pinch.
    type GestureEventLike = Event & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      if (pointers.size < 2) gesture = { z: view.current.z };
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      if (!gesture || pinch) return;
      const { scale, clientX, clientY } = event as GestureEventLike;
      const [cx, cy] = local(clientX, clientY);
      apply(zoomPlanMapAt(view.current, gesture.z * scale, cx, cy));
    };
    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      gesture = null;
    };

    const zoomCenter = (z: number) => apply(zoomPlanMapAt(view.current, z, viewport.clientWidth / 2, viewport.clientHeight / 2));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const { z, tx, ty } = view.current;
      const moves: Record<string, () => void> = {
        "+": () => zoomCenter(z * ZOOM_STEP),
        "=": () => zoomCenter(z * ZOOM_STEP),
        "-": () => zoomCenter(z / ZOOM_STEP),
        _: () => zoomCenter(z / ZOOM_STEP),
        "0": () => zoomCenter(1),
        ArrowLeft: () => apply({ z, ty, tx: tx + KEY_STEP }),
        ArrowRight: () => apply({ z, ty, tx: tx - KEY_STEP }),
        ArrowUp: () => apply({ z, tx, ty: ty + KEY_STEP }),
        ArrowDown: () => apply({ z, tx, ty: ty - KEY_STEP }),
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      move();
    };

    // Tabbing can land on a node just off screen. The frame clips rather than
    // scrolls, so bring the node in by moving the map.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Element | null;
      if (!target || !canvasRef.current?.contains(target)) return;
      const box = target.getBoundingClientRect();
      const frame = viewport.getBoundingClientRect();
      const pad = 24;
      const dx = box.left < frame.left + pad ? frame.left + pad - box.left : box.right > frame.right - pad ? frame.right - pad - box.right : 0;
      const dy = box.top < frame.top + pad ? frame.top + pad - box.top : box.bottom > frame.bottom - pad ? frame.bottom - pad - box.bottom : 0;
      if (dx || dy) apply({ ...view.current, tx: view.current.tx + dx, ty: view.current.ty + dy });
    };

    // Keep the same part of the map in the middle when the frame changes size.
    let lastW = viewport.clientWidth;
    let lastH = viewport.clientHeight;
    const resize = new ResizeObserver(() => {
      const w = viewport.clientWidth;
      const h = viewport.clientHeight;
      if (!w || !h) return;
      const dx = lastW ? (w - lastW) / 2 : 0;
      const dy = lastH ? (h - lastH) / 2 : 0;
      lastW = w;
      lastH = h;
      apply({ ...view.current, tx: view.current.tx + dx, ty: view.current.ty + dy }, true);
    });
    resize.observe(viewport);

    const onFullscreen = () => setFullscreen(document.fullscreenElement === viewport);

    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", onPointerEnd);
    viewport.addEventListener("pointercancel", onPointerEnd);
    viewport.addEventListener("lostpointercapture", onLostCapture);
    viewport.addEventListener("click", onClickCapture, true);
    viewport.addEventListener("dragstart", preventDrag);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("gesturestart", onGestureStart);
    viewport.addEventListener("gesturechange", onGestureChange);
    viewport.addEventListener("gestureend", onGestureEnd);
    viewport.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("focusin", onFocusIn);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      resize.disconnect();
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerEnd);
      viewport.removeEventListener("pointercancel", onPointerEnd);
      viewport.removeEventListener("lostpointercapture", onLostCapture);
      viewport.removeEventListener("click", onClickCapture, true);
      viewport.removeEventListener("dragstart", preventDrag);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("gesturestart", onGestureStart);
      viewport.removeEventListener("gesturechange", onGestureChange);
      viewport.removeEventListener("gestureend", onGestureEnd);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("fullscreenchange", onFullscreen);
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, [apply]);

  const visible = useMemo(() => (drawnWindow ? planMapInWindow(layout, drawnWindow) : NO_NODES), [layout, drawnWindow]);
  const searching = hits.size > 0;

  const zoomBy = (factor: number) => {
    const area = size();
    apply(zoomPlanMapAt(view.current, view.current.z * factor, area.w / 2, area.h / 2));
  };
  const toggleFullscreen = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (document.fullscreenElement === viewport) void document.exitFullscreen().catch(() => {});
    else void viewport.requestFullscreen().catch(() => {});
  };

  return (
    <div
      ref={viewportRef}
      tabIndex={0}
      role="group"
      aria-label={copy.viewportLabel}
      className="focus-inset relative h-[72svh] min-h-[440px] cursor-grab touch-none select-none overflow-clip overscroll-contain rounded-xl bg-surface data-[panning]:cursor-grabbing data-[panning]:[&_*]:!cursor-grabbing [&:fullscreen]:h-screen [&:fullscreen]:rounded-none"
      style={{
        backgroundImage: "radial-gradient(rgb(var(--border)) 1px, transparent 1.3px)",
        backgroundSize: `${DOT_SPACING}px ${DOT_SPACING}px`,
      }}
    >
      <div ref={canvasRef} className="absolute left-0 top-0 origin-top-left">
        {drawnWindow && (
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute overflow-visible"
            style={{ left: drawnWindow.x, top: drawnWindow.y }}
            width={drawnWindow.w}
            height={drawnWindow.h}
            viewBox={`${drawnWindow.x} ${drawnWindow.y} ${drawnWindow.w} ${drawnWindow.h}`}
          >
            <path d={visible.edges} fill="none" strokeWidth={1.5} className="stroke-muted/40" />
          </svg>
        )}
        {visible.nodes.map((entry) => {
          const hit = hits.has(entry.id);
          const dim = searching && !hit;
          if (entry.kind === "problem") {
            return <PlanMapProblemNode key={entry.id} entry={entry} status={statuses[entry.slug!]} hit={hit} dim={dim} />;
          }
          const count = counts.get(entry.id);
          return (
            <PlanMapBranchNode key={entry.id} entry={entry} solved={count?.solved ?? 0} total={count?.total ?? 0} hit={hit} dim={dim} />
          );
        })}
      </div>

      <p className="pointer-events-none absolute bottom-3 left-3 z-20 rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-muted">
        {copy.hint}
      </p>
      <div
        data-map-controls
        role="group"
        aria-label={copy.controls}
        className="absolute bottom-2.5 right-2.5 z-20 flex cursor-default items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-card"
      >
        <Button variant="ghost" size="icon" aria-label={copy.zoomOut} title={copy.zoomOut} onClick={() => zoomBy(1 / ZOOM_STEP)}>
          <Minus aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={copy.zoomReset}
          title={copy.zoomReset}
          className="w-14 px-0 tabular-nums"
          onClick={() => {
            const area = size();
            apply(zoomPlanMapAt(view.current, 1, area.w / 2, area.h / 2));
          }}
        >
          <span ref={percentRef}>100%</span>
        </Button>
        <Button variant="ghost" size="icon" aria-label={copy.zoomIn} title={copy.zoomIn} onClick={() => zoomBy(ZOOM_STEP)}>
          <Plus aria-hidden="true" className="size-4" />
        </Button>
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="icon"
          aria-label={copy.fit}
          title={copy.fit}
          onClick={() => apply(fitPlanMapView(size(), layoutRef.current))}
        >
          <Scan aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={copy.center}
          title={copy.center}
          onClick={() => apply(rootPlanMapView(view.current.z, size(), layoutRef.current.nodes[0]!))}
        >
          <LocateFixed aria-hidden="true" className="size-4" />
        </Button>
        {canFullscreen && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={fullscreen ? copy.exitFullscreen : copy.fullscreen}
            title={fullscreen ? copy.exitFullscreen : copy.fullscreen}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize aria-hidden="true" className="size-4" /> : <Maximize aria-hidden="true" className="size-4" />}
          </Button>
        )}
      </div>
    </div>
  );
}
