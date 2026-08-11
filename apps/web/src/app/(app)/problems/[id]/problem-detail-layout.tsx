"use client";

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

const MIN_RAIL_WIDTH = 240;
const MAX_RAIL_WIDTH = 400;
const MIN_WORKSPACE_WIDTH = 360;
const RESIZER_WIDTH = 20;

export function ProblemDetailLayout({
  rail,
  workspace,
}: {
  rail: ReactNode;
  workspace: ReactNode;
}) {
  const [railWidth, setRailWidth] = useState(300);
  const layoutRef = useRef<HTMLDivElement | null>(null);

  const bounds = useCallback(() => {
    const width = layoutRef.current!.getBoundingClientRect().width;
    return {
      min: MIN_RAIL_WIDTH,
      max: Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, width - MIN_WORKSPACE_WIDTH - RESIZER_WIDTH)),
    };
  }, []);

  const resize = useCallback((clientX: number) => {
    const rect = layoutRef.current!.getBoundingClientRect();
    const range = bounds();
    setRailWidth(Math.min(range.max, Math.max(range.min, clientX - rect.left)));
  }, [bounds]);

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resize(event.clientX);

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const handleMove = (moveEvent: PointerEvent) => resize(moveEvent.clientX);
    const stop = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop, { once: true });
  }, [resize]);

  const resizeWithKeyboard = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const range = bounds();
    const delta = event.key === "ArrowLeft" ? -20 : 20;
    setRailWidth((current) => Math.min(range.max, Math.max(range.min, current + delta)));
  }, [bounds]);

  return (
    <div
      ref={layoutRef}
      className="grid gap-5 lg:grid-cols-[var(--problem-rail-width)_20px_minmax(0,1fr)] lg:gap-0"
      style={{ "--problem-rail-width": `${railWidth}px` } as CSSProperties}
    >
      <div className="min-w-0">{rail}</div>
      <div
        role="separator"
        aria-label="Resize problem panels"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
        className="group hidden cursor-col-resize items-stretch justify-center px-2 outline-none lg:flex"
      >
        <div className="my-1 w-px rounded-full bg-border transition group-hover:bg-accent group-focus-visible:bg-accent" />
      </div>
      <div className="min-w-0">{workspace}</div>
    </div>
  );
}
