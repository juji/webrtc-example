"use client";

import { useEffect, useRef, useState } from "react";
import { SqliteTab } from "./dev-panel-sqlite-tab";

const TABS = {
  sqlite: { label: "sqlite", Component: SqliteTab },
} as const;

type TabKey = keyof typeof TABS;

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const CORNER_STORAGE_KEY = "dev-panel-corner";

const CORNER_CLASSES: Record<Corner, string> = {
  "top-left": "top-4 left-4",
  "top-right": "top-4 right-4",
  "bottom-left": "bottom-4 left-4",
  "bottom-right": "bottom-4 right-4",
};

function nearestCorner(x: number, y: number): Corner {
  const vertical = y < window.innerHeight / 2 ? "top" : "bottom";
  const horizontal = x < window.innerWidth / 2 ? "left" : "right";
  return `${vertical}-${horizontal}` as Corner;
}

// Floating dev-only panel, mounted in the root layout behind
// NEXT_PUBLIC_DEV. Tab bar across the top, one tab's content below —
// add more tabs by adding to TABS above. Drag the button/panel toward any
// corner and it snaps to the nearest one on release; the choice persists
// across reloads via localStorage.
export function DevPanel() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<TabKey>("sqlite");
  const [corner, setCorner] = useState<Corner>("bottom-right");
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem(CORNER_STORAGE_KEY);
    if (saved && saved in CORNER_CLASSES) setCorner(saved as Corner);
  }, []);

  function handlePointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { x: e.clientX, y: e.clientY, moved: false };
    setDragging(true);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (Math.hypot(dx, dy) > 8) dragStart.current.moved = true;
    if (dragStart.current.moved) setDragPos({ x: e.clientX, y: e.clientY });
  }

  function handlePointerUp(e: React.PointerEvent) {
    setDragging(false);
    setDragPos(null);
    if (dragStart.current?.moved) {
      justDragged.current = true;
      const next = nearestCorner(e.clientX, e.clientY);
      setCorner(next);
      localStorage.setItem(CORNER_STORAGE_KEY, next);
    }
    dragStart.current = null;
  }

  // pointerup fires (and clears dragStart) before the browser's synthetic
  // click event, so onClick handlers check this instead — cleared right
  // after so the next real click isn't suppressed too.
  function wasDrag() {
    if (!justDragged.current) return false;
    justDragged.current = false;
    return true;
  }

  if (!open) {
    return (
      <button
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={() => {
          if (!wasDrag()) setOpen(true);
        }}
        style={dragPos ? { left: dragPos.x, top: dragPos.y, right: "auto", bottom: "auto" } : undefined}
        className={`fixed z-50 rounded-full bg-green-300 px-3 py-1.5 text-sm font-medium text-black ${dragPos ? "-translate-x-1/2 -translate-y-1/2" : CORNER_CLASSES[corner]} ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      >
        dev
      </button>
    );
  }

  const ActiveTab = TABS[active].Component;

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-4 z-50 flex flex-col overflow-hidden rounded-lg border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-900"
          : `fixed z-50 flex max-h-[70vh] w-[min(90vw,32rem)] flex-col overflow-hidden rounded-lg border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-zinc-900 ${CORNER_CLASSES[corner]}`
      }
    >
      <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10">
        <div className="flex">
          {(Object.keys(TABS) as TabKey[]).map((key) => (
            <button
              key={key}
              onClick={() => setActive(key)}
              className={`px-3 py-2 text-sm font-medium ${
                active === key
                  ? "border-b-2 border-orange-600 text-orange-600"
                  : "text-zinc-500"
              }`}
            >
              {TABS[key].label}
            </button>
          ))}
        </div>
        <div className="flex">
          <button onClick={() => setFullscreen((v) => !v)} className="px-3 py-2 text-sm text-blue-400">
            {fullscreen ? "⤢" : "⤡"}
          </button>
          <button onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-red-600">
            ×
          </button>
        </div>
      </div>
      <div className="overflow-auto">
        <ActiveTab />
      </div>
    </div>
  );
}
