// Packaged XPI, real PDF reader, original quote cards and disk-backed history. No model prompts.
async function main(ctx) {
  const { Zotero, IOUtils, PathUtils, win } = ctx;
  const fixture = JSON.parse(await IOUtils.readUTF8(ctx.env("ZMC_SELECTION_FIXTURES")));
  const check = (ok, why) => { if (!ok) throw Error(why); };
  check(PathUtils.normalize(Zotero.Profile.dir) === PathUtils.normalize(fixture.profile), "Unexpected profile");
  check(PathUtils.normalize(Zotero.DataDirectory.dir) === PathUtils.normalize(fixture.data), "Unexpected library");
  const panel = ctx.plugin.panel(), { host, bundle } = panel;
  // Any incidental prewarming uses an in-memory stub. This test never starts an installed model client.
  host.runtime.start = async () => ({ backend: "claude-code", sessionId: "selection-fixture", supportsImages: false,
    models: () => [], modes: () => [], currentModel: () => undefined, currentMode: () => undefined,
    on: () => () => {}, close: async () => {}, prompt: async () => { throw Error("No inference permitted in this fixture"); } });
  host.runtime.catalog = async () => ({ models: [], modes: [] });
  host.runtime.detect = async () => [{ id: "claude-code", label: "Claude Code", available: true, account: "Selection fixture" }];
  host.doctor = async () => [];
  host.runtime.accountUsage = async () => ({ backend: "claude-code", status: "unavailable", fetchedAt: Date.now(), windows: [] });
  await ctx.resize(1280, 900);
  ctx.plugin.windows.get(win).show();
  const root = win.document.getElementById("zmc-root").shadowRoot;
  // A background Gecko window can pause entry animations at opacity 0; snapshots use settled content.
  const settled = win.document.createElementNS("http://www.w3.org/1999/xhtml", "style");
  settled.textContent = ".zmc .msg { animation: none !important; }"; root.append(settled);
  const $ = (s) => root.querySelector(s);
  const att = await Zotero.Attachments.importFromFile({ file: Zotero.File.pathToFile(fixture.pdf), libraryID: Zotero.Libraries.userLibraryID });
  await Zotero.Reader.open(att.id);
  const reader = await ctx.waitFor(() => Zotero.Reader._readers.find(r => r.itemID === att.id && r._internalReader), "reader");
  await reader._initPromise;
  await ctx.waitFor(() => Number.isInteger(reader._internalReader._state.primaryViewStats?.pageIndex) && reader._internalReader._state.primaryViewStats.pagesCount, "reader view stats");
  const view = reader._internalReader._lastView;
  await view.initializedPromise;
  await view._ensureBasicPageData(0);
  const chars = Array.from(view._pdfPages[0].chars);
  const indices = [], letters = [];
  chars.forEach((c, i) => { for (const l of c.c.toLowerCase().replace(/[^a-z]/g, "")) { letters.push(l); indices.push(i); } });
  const text = "The selected passage appears twice in this test document.";
  const needle = text.toLowerCase().replace(/[^a-z]/g, "");
  const found = letters.join("").lastIndexOf(needle);
  check(found > letters.join("").indexOf(needle), "Fixture needs two identical passages");
  const first = chars[indices[found]], last = chars[indices[found + needle.length - 1]];
  const position = { pageIndex: 0, rects: [[first.rect[0], first.inlineRect[1], last.rect[2], first.inlineRect[3]]] };
  const event = { reader, params: { annotation: { text, pageLabel: "1", position } } };
  const stats = reader._internalReader._state.primaryViewStats;
  reader._internalReader._state.primaryViewStats = { ...stats, canCopy: true };
  bundle.context.onPopup(event);
  let quote;
  try { quote = await ctx.waitFor(() => $(".cchips .selection__text"), "visible original selection"); }
  catch (e) { await ctx.snapshot("selection-failed"); ctx.log("panel", root.textContent.slice(-1800)); throw e; }
  check(quote.textContent === text, "Composer must show the actual source text");
  const chip = host.currentContext().find(c => c.kind === "selection");
  const savedPosition = JSON.parse(JSON.stringify(chip.ref.position));
  position.rects[0][0] += 20;
  check(chip.ref.position.rects[0][0] === savedPosition.rects[0][0], "Reader updates must not mutate saved positions");
  await host.open({ libraryID: att.libraryID, attachmentKey: att.key, pageIndex: 1 });
  quote.click();
  const highlight = await ctx.waitFor(() => view._highlightedPosition, "highlight from original text click");
  check(JSON.stringify(highlight.rects) === JSON.stringify(savedPosition.rects), "Click must return to the second occurrence, not the first");
  check(highlight.pageIndex === 0, "Click must return to page 1");
  await ctx.snapshot("selection-original-highlight");
  await ctx.waitFor(() => !view._highlightedPosition, "temporary highlight fades", 5000);

  const session = { id: "selection-history", title: "Selection history test", backend: "claude-code", agentSessionId: "", cwd: fixture.cwd,
    projectName: "Selection test", updatedAt: Date.now(), paper: host.currentPaper() };
  await host.saveSession(session);
  const summary = { id: chip.id, kind: chip.kind, label: chip.label, ref: chip.ref, text: chip.text };
  await host.appendEvent(session, { t: "user", id: "question", text: "请解释这段原文", chips: [summary] });
  const disk = await host.loadEvents(session.id);
  check(disk[0].chips[0].text === text && JSON.stringify(disk[0].chips[0].ref.position) === JSON.stringify(savedPosition), "Disk history must retain source text and geometry");
  const history = $("button[aria-label='历史对话']") || $("button[aria-label='History']");
  check(history, "History button exists"); history.click();
  const row = await ctx.waitFor(() => [...root.querySelectorAll(".hrow__main")].find(b => b.textContent.includes(session.title)), "saved history row");
  row.click();
  const pastQuote = await ctx.waitFor(() => $(".ubub .selection__text"), "original text restored in transcript");
  check(pastQuote.textContent === text, "Restored transcript must show original text");
  await host.open({ libraryID: att.libraryID, attachmentKey: att.key, pageIndex: 1 });
  pastQuote.click();
  const replayed = await ctx.waitFor(() => view._highlightedPosition, "highlight after history replay");
  check(JSON.stringify(replayed.rects) === JSON.stringify(savedPosition.rects), "Restored quote must preserve exact position");
  await ctx.sleep(150);
  check($(".ubub .selection__text")?.getBoundingClientRect().height > 0, "Original quote must remain visible after navigation");
  await ctx.snapshot("selection-history-highlight");
  await ctx.waitFor(() => !view._highlightedPosition, "replayed highlight fades", 5000);

  const oldRef = { ...chip.ref }; delete oldRef.position;
  await host.open({ ...oldRef, quote: text });
  const fallback = await ctx.waitFor(() => view._highlightedPosition, "old history text fallback");
  check(fallback.pageIndex === 0 && fallback.rects.length > 0, "Old history must still locate and highlight the text");
  check(att.getAnnotations().length === 0, "Clicking original text must not create permanent annotations");
  return { composerOriginal: true, exactRepeatedPassage: true, savedHistory: true, historyClickHighlight: true, oldHistoryTextFallback: true, temporaryHighlight: true, annotationsCreated: 0 };
}
