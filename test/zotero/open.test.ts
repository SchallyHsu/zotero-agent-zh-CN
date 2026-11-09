import { test } from "node:test";
import assert from "node:assert/strict";
import { openTarget } from "../../src/zotero/open.ts";
import { selectionPosition } from "../../src/zotero/selection.ts";

test("selection positions are independent snapshots; invalid or non-PDF positions use text fallback", () => {
  const live = { pageIndex: 2, rects: [[1, 2, 3, 4]], nextPageRects: [[5, 6, 7, 8]] };
  const saved = selectionPosition(live)!;
  live.rects[0]![0] = 99;
  live.nextPageRects[0]![0] = 99;
  assert.equal(saved.rects[0]![0], 1);
  assert.equal(saved.nextPageRects![0]![0], 5);
  for (const bad of [null, {}, { pageIndex: -1, rects: [[1, 2, 3, 4]] }, { pageIndex: 0, rects: [[1, NaN, 3, 4]] }, { pageIndex: 0, rects: [] }, { pageIndex: 0, rects: [[1, 2, 3]] }, { cfi: "epubcfi(...)" }]) assert.equal(selectionPosition(bad), undefined);
});

test("reader navigation preserves exact selections, falls back for old history and keeps ordinary links working", async () => {
  const calls: { id: number; location: unknown }[] = [], jumps: any[] = [], errors: unknown[] = [];
  const chars = [..."the original selected passage"].map((c, i) => ({ c, rect: [i * 5, 0, i * 5 + 5, 10], inlineRect: [0, 0, 150, 10], rotation: 0 }));
  const view = { initializedPromise: Promise.resolve(), _pageLabelsPromise: Promise.resolve(), _pageLabels: ["i", "ii", "iii"],
    _pdfPages: [{ chars: [] }, { chars: [] }, { chars }], _ensureBasicPageData: async () => {}, _iframeWindow: { PDFViewerApplication: { pdfDocument: { numPages: 3 } } } };
  const reader = { itemID: 42, _initPromise: Promise.resolve(), _internalReader: { _lastView: view }, navigate: async (location: unknown) => { jumps.push(location); } };
  const zotero = { Libraries: { userLibraryID: 1 }, Groups: { getLibraryIDFromGroupID: () => 2 },
    Items: { getByLibraryAndKey: (library: number, key: string) => key === "PDF00001" && (library === 1 || library === 2) ? { id: 42 } : null },
    Reader: { _readers: [reader], open: async (id: number, location: unknown) => { calls.push({ id, location }); return reader; } }, logError: (e: unknown) => errors.push(e) };
  const globals = globalThis as unknown as { Zotero?: unknown };
  const prior = globals.Zotero;
  globals.Zotero = zotero;
  try {
    const position = { pageIndex: 1, rects: [[10, 20, 30, 40]], nextPageRects: [[50, 60, 70, 80]] };
    await openTarget({}, { libraryID: 2, attachmentKey: "PDF00001", pageIndex: 1, position, quote: "repeated words" });
    assert.deepEqual(jumps.pop(), { position });
    assert.equal(calls.at(-1)!.location, undefined, "existing reader focuses without jumping before the highlight");

    await openTarget({}, { libraryID: 1, attachmentKey: "PDF00001", pageIndex: 2, pageLabel: "wrong label", quote: "the original selected passage" });
    const found = jumps.pop();
    assert.equal(found.position.pageIndex, 2);
    assert.ok(found.position.rects.length);

    await openTarget({}, "zotero://open-pdf/groups/123/items/PDF00001?page=iii&quote=the%20original%20selected%20passage");
    assert.equal(jumps.pop().position.pageIndex, 2, "existing citation URI still searches the printed page label");
    await openTarget({}, { libraryID: 1, attachmentKey: "PDF00001", pageIndex: 1, quote: "words absent from all pages" });
    assert.deepEqual(jumps.pop(), { pageIndex: 1 }, "a miss still jumps to the right page");

    await openTarget({}, { libraryID: 1, attachmentKey: "PDF00001", annotationKey: "ANN00001", quote: "ignored" });
    assert.deepEqual(calls.at(-1)!.location, { annotationID: "ANN00001" });
    await openTarget({}, "zotero://open-pdf/library/items/PDF00001?page=ii");
    assert.deepEqual(calls.at(-1)!.location, { pageLabel: "ii" });
    assert.deepEqual(errors, []);
  } finally { if (prior === undefined) delete globals.Zotero; else globals.Zotero = prior; }
});
