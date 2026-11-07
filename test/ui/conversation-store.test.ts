import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../../src/zotero/store.ts";
import type { SavedSession } from "../../src/types.ts";

test("metadata survives stale streaming writes, multiple hosts, migration and reload", async () => {
  const files = new Map<string, string>();
  Object.assign(globalThis, {
    PathUtils: { join: (...s: string[]) => s.join("/") },
    IOUtils: {
      readUTF8: async (p: string) => { if (!files.has(p)) throw new Error("absent"); return files.get(p)!; },
      makeDirectory: async () => {},
      writeUTF8: async (p: string, s: string, o?: { mode?: string }) => { files.set(p, (o?.mode === "appendOrCreate" ? files.get(p) ?? "" : "") + s); },
      remove: async (p: string) => { files.delete(p); },
    },
  });
  const store = createStore("history"), other = createStore("history");
  const s: SavedSession = { id: "s1", title: "Old", backend: "codex", cwd: "C:/original", agentSessionId: "native-1", updatedAt: 10 };
  await store.appendEvent(s, { t: "user", id: "u1", text: "question", chips: [{ id: "r", kind: "reader", label: "Paper", ref: { libraryID: 2, itemKey: "PAPER001" } }] });
  const migrated = (await store.sessions())[0]!;
  assert.equal(migrated.projectName, "Zotero Agent");
  assert.equal(migrated.paper?.libraryID, 2);
  assert.equal(migrated.cwd, "C:/original");
  await Promise.all([store.renameSession("s1", "New name"), other.appendEvent(s, { t: "text", turn: "t1", delta: "streaming" })]);
  await other.saveSession(s);
  const renamed = (await createStore("history").sessions())[0]!;
  assert.equal(renamed.title, "New name");
  assert.equal(renamed.paper?.itemKey, "PAPER001");
  assert.equal((await store.loadEvents("s1")).length, 2);
  await assert.rejects(store.renameSession("s1", "  "));
  await store.deleteSession("s1");
  assert.equal(await store.patchSession("s1", { syncError: "" }), null);
  assert.deepEqual(await store.sessions(), []);
});
