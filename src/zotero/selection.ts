import type { SelectionPosition } from "../types.ts";

/** Copy out of the reader's JS compartment; never retain its mutable selection arrays in history. */
export function selectionPosition(value: unknown): SelectionPosition | undefined {
  if (!value || typeof value !== "object") return;
  const p = value as Partial<SelectionPosition>;
  if (!Number.isInteger(p.pageIndex) || p.pageIndex! < 0) return;
  const rects = (v: unknown): number[][] | undefined => {
    if (!Array.isArray(v) || !v.length) return;
    const copied: number[][] = [];
    for (const rect of v) {
      if (!Array.isArray(rect) || rect.length !== 4 || !rect.every((n) => typeof n === "number" && Number.isFinite(n))) return;
      copied.push(Array.from(rect));
    }
    return copied;
  };
  const first = rects(p.rects);
  if (!first) return;
  const next = rects(p.nextPageRects);
  return { pageIndex: p.pageIndex!, rects: first, ...(next ? { nextPageRects: next } : {}) };
}
