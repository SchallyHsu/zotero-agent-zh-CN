import { test } from "node:test";
import assert from "node:assert/strict";
import { latestPaperSession, paperFromChips, paperKey, projectFolderName } from "../../src/ui/session-model.ts";
import { withDefaults } from "../../src/zotero/defaults.ts";
import type { SavedSession } from "../../src/types.ts";

const paper = { libraryID: 1, itemKey: "PAPER001", title: "Same title" };
const session = (id: string, patch: Partial<SavedSession> = {}): SavedSession => ({ id, title: id, backend: "codex", cwd: "C:/papers", agentSessionId: id, updatedAt: 10, paper, ...patch });

test("paper identity separates libraries, ignores PDF/page differences and ambiguous selections", () => {
  const item = { kind: "item" as const, label: "A", ref: paper };
  assert.equal(paperKey(paperFromChips([item])), "1:PAPER001");
  assert.equal(paperFromChips([item, { ...item, ref: { ...paper, itemKey: "PAPER002" } }]), null);
  assert.equal(paperKey(paperFromChips([item, { ...item, kind: "reader", ref: { libraryID: 2, itemKey: "PAPER001", attachmentKey: "PDF00001", pageIndex: 9 } }])), "2:PAPER001");
});

test("resume the last opened chat for this paper and backend, including earlier projects", () => {
  const all = [session("recent-message", { updatedAt: 100 }), session("last-opened", { lastOpenedAt: 200, projectName: "Older project" }), session("other-agent", { backend: "pi", lastOpenedAt: 999 }), session("other-library", { paper: { ...paper, libraryID: 2 }, lastOpenedAt: 999 })];
  assert.equal(latestPaperSession(all, paper, "codex")?.id, "last-opened");
  assert.equal(latestPaperSession(all, { ...paper, itemKey: "MISSING" }, "codex"), undefined);
});

test("old preferences gain sensible defaults and project display names cannot escape the folder", () => {
  assert.equal(withDefaults({}).projectName, "Zotero Agent");
  assert.equal(withDefaults({}).autoResumePaper, true);
  assert.equal(withDefaults({ projectName: "  " }).projectName, "Zotero Agent");
  assert.equal(withDefaults({ autoResumePaper: false }).autoResumePaper, false);
  assert.equal(projectFolderName("Zotero Agent"), "Zotero Agent");
  assert.equal(projectFolderName("中文项目"), "中文项目");
  for (const name of ["..", "../../outside", "C:\\outside", "CON", "a/b", "a?b", ".", "a".repeat(150)]) {
    const p = projectFolderName(name);
    assert(!/[<>:"/\\|?*]/.test(p)); assert(!/[. ]$/.test(p)); assert(p !== "." && p !== "..");
  }
  assert.notEqual(projectFolderName("a/b"), projectFolderName("a?b"));
});
