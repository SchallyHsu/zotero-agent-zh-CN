// Chat history: <dir>/index.json (the list) and <dir>/<id>.jsonl (one ChatEvent per line, replayed through the same
// reducer that rendered it live). Lives in the profile, outside Zotero library sync. Optional WebDAV sync uses portable snapshots.
import type { ChatEvent, SavedSession } from "../types.ts";
import { DEFAULT_PROJECT, paperFromChips } from "../ui/session-model.ts";
import { emptyDocument, legacyId, mapEvent, mergeDocuments, shareSession, type SharedEvent, type SyncDocument } from "../sync/model.ts";
import type { ZoteroRef } from "../types.ts";
const shared = typeof Zotero === "undefined" ? {} as any : (Zotero.__zmcChatStore ??= {});
const chains: Map<string, Promise<unknown>> = shared.chains ??= new Map();
const active: Map<string, Set<string>> = shared.active ??= new Map();

export function createStore(dir: string, refs: { upload(r: ZoteroRef): ZoteroRef; download(r: ZoteroRef): ZoteroRef } = { upload: r => r, download: r => r }) {
  const index = PathUtils.join(dir, "index.json");
  const file = (id: string) => PathUtils.join(dir, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.jsonl`);
  const deletedFile = PathUtils.join(dir, "deleted.json");
  const recoveryFile = PathUtils.join(dir, "sync-recovery.json");
  const busy = active.get(dir) ?? new Set<string>();
  active.set(dir, busy);
  const newId = () => typeof Services !== "undefined" ? Services.uuid.generateUUID().toString().slice(1, -1) : globalThis.crypto.randomUUID();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = (chains.get(index) ?? Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    chains.set(index, tail);
    void tail.then(() => { if (chains.get(index) === tail) chains.delete(index); });
    return run;
  };

  async function readIndex(): Promise<SavedSession[]> {
    try {
      return JSON.parse(await IOUtils.readUTF8(index)).sessions ?? [];
    } catch (e) {
      if (missing(e)) return [];
      throw e;
    }
  }

  async function records(id: string): Promise<SharedEvent[]> {
    let text: string;
    try { text = await IOUtils.readUTF8(file(id)); } catch (e) { if (missing(e)) return []; throw e; }
    return text.split("\n").filter(Boolean).map((line, n) => {
      const { _syncId, ...event } = JSON.parse(line);
      return { id: _syncId || legacyId(id, n, event as ChatEvent), event: event as ChatEvent };
    });
  }
  async function tombstones(): Promise<SyncDocument> {
    try { return JSON.parse(await IOUtils.readUTF8(deletedFile)); } catch (e) { if (missing(e)) return emptyDocument(); throw e; }
  }
  async function exportDocument(): Promise<SyncDocument> {
    const doc = await tombstones();
    for (const s of await readIndex()) {
      if (busy.has(s.id)) continue; // publish complete rounds, never half a streamed reply
      doc.chats[s.id] = { session: shareSession(s, refs.upload), events: (await records(s.id)).map(e => ({ ...e, event: mapEvent(e.event, refs.upload) })) };
    }
    // A journal survives interruption between replacing several conversation files and the index.
    try { return mergeDocuments(JSON.parse(await IOUtils.readUTF8(recoveryFile)), doc); }
    catch (e) { if (missing(e)) return doc; throw e; }
  }
  async function remove(id: string): Promise<void> {
    if (busy.has(id)) throw Error("Wait for the current reply before deleting this chat.");
    const all = await readIndex(), s = all.find(s => s.id === id);
    if (!s) return;
    const doc = await tombstones();
    doc.chats[id] = { session: shareSession(s, refs.upload), events: [], deleted: (await records(id)).map(e => e.id) };
    await IOUtils.writeUTF8(deletedFile, JSON.stringify(doc), { tmpPath: `${deletedFile}.tmp` });
    await IOUtils.writeUTF8(index, JSON.stringify({ sessions: all.filter(s => s.id !== id) }), { tmpPath: `${index}.tmp` });
    await IOUtils.remove(file(id), { ignoreAbsent: true });
  }

  async function save(session: SavedSession): Promise<SavedSession> {
    await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
    const all = await readIndex();
    const i = all.findIndex((s) => s.id === session.id);
    const prev = all[i];
    const entry = { ...prev, ...session };
    // A streaming writer or a different window may still carry the old title.
    if (prev && (prev.titleUpdatedAt ?? 0) > (session.titleUpdatedAt ?? 0)) {
      entry.title = prev.title; entry.titleUpdatedAt = prev.titleUpdatedAt;
    }
    entry.lastOpenedAt = Math.max(prev?.lastOpenedAt ?? 0, session.lastOpenedAt ?? 0) || undefined;
    entry.updatedAt = Math.max(prev?.updatedAt ?? 0, session.updatedAt);
    if (i >= 0) all[i] = entry; else all.push(entry);
    await IOUtils.writeUTF8(index, JSON.stringify({ sessions: all }), { tmpPath: `${index}.tmp` });
    return entry;
  }

  return {
    sessions: () => serial(async () => {
      const all = await readIndex();
      let changed = false;
      for (let i = 0; i < all.length; i++) {
        const s = all[i]!;
        if (s.projectName !== undefined) continue;
        let paper = s.paper;
        if (!paper) try {
          const text = await IOUtils.readUTF8(file(s.id));
          for (const line of text.split("\n")) {
            let ev: ChatEvent;
            try { ev = JSON.parse(line); } catch { continue; }
            if (ev.t === "user") { paper = paperFromChips(ev.chips) ?? undefined; break; }
          }
        } catch { /* Missing logs stay available in the history list. */ }
        all[i] = { ...s, projectName: DEFAULT_PROJECT, ...(paper ? { paper } : {}) };
        changed = true;
      }
      if (changed) await IOUtils.writeUTF8(index, JSON.stringify({ sessions: all }), { tmpPath: `${index}.tmp` });
      return all.sort((a, b) => b.updatedAt - a.updatedAt);
    }),
    saveSession: (session: SavedSession) => serial(() => save(session)),
    patchSession: (id: string, patch: Partial<SavedSession>) => serial(async () => {
      const s = (await readIndex()).find((s) => s.id === id);
      return s ? save({ ...s, ...patch }) : null;
    }),
    renameSession: (id: string, title: string) => serial(async () => {
      const s = (await readIndex()).find((s) => s.id === id);
      if (!s) throw new Error("Chat no longer exists");
      const clean = title.trim().slice(0, 200);
      if (!clean) throw new Error("Enter a chat name");
      return save({ ...s, title: clean, titleUpdatedAt: Math.max(Date.now(), (s.titleUpdatedAt ?? 0) + 1) });
    }),

    async loadEvents(id: string): Promise<ChatEvent[]> {
      try {
        const text = await IOUtils.readUTF8(file(id));
        return text.split("\n").filter(Boolean).flatMap((l: string) => { try { const { _syncId, ...ev } = JSON.parse(l); return [ev as ChatEvent]; } catch { return []; } });
      } catch {
        return [];
      }
    },

    appendEvent: (session: SavedSession, ev: ChatEvent) => serial(async () => {
      await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
      const syncId = newId();
      await IOUtils.writeUTF8(file(session.id), JSON.stringify({ ...ev, _syncId: syncId }) + "\n", { mode: "appendOrCreate" });
      const current = (await readIndex()).find((s) => s.id === session.id);
      await save({ ...session, ...(current ? { title: current.title, titleUpdatedAt: current.titleUpdatedAt, agentSessionId: current.agentSessionId || session.agentSessionId, backendProjectId: current.backendProjectId, backendSyncedTitle: current.backendSyncedTitle, backendSyncedProjectName: current.backendSyncedProjectName, backendSyncVersion: current.backendSyncVersion, syncPending: current.syncPending, syncError: current.syncError, needsContextReplay: current.needsContextReplay } : {}), contentVersion: syncId, updatedAt: Date.now() });
    }),

    beginTurn: (id: string) => { if (busy.has(id)) throw Error("This chat is already running in another window."); busy.add(id); },
    endTurn: (id: string) => { busy.delete(id); },
    exportDocument: () => serial(exportDocument),
    /** Re-merge under the disk lock: local changes made during an HTTP request must survive. */
    importDocument: (remote: SyncDocument) => serial(async () => {
      await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
      const doc = mergeDocuments(remote, await exportDocument());
      await IOUtils.writeUTF8(recoveryFile, JSON.stringify(doc), { tmpPath: `${recoveryFile}.tmp` });
      const all = await readIndex(), deleted = await tombstones();
      const next: SavedSession[] = all.filter(s => busy.has(s.id));
      for (const [id, chat] of Object.entries(doc.chats)) {
        if (busy.has(id)) continue;
        if (chat.deleted) { deleted.chats[id] = chat; continue; }
        const prev = all.find(s => s.id === id), old = await records(id);
        const changed = old.length !== chat.events.length || old.some((e, i) => e.id !== chat.events[i]?.id);
        const paper = chat.session.paper;
        const s: SavedSession = { cwd: "", agentSessionId: "", ...prev, ...chat.session,
          ...(paper ? { paper: { ...paper, ...refs.download(paper) } } : {}),
          contentVersion: chat.events.at(-1)?.id || "empty",
          ...(!prev || changed ? { cwd: "", agentSessionId: "", needsContextReplay: chat.events.length > 0, backendProjectId: undefined, backendSyncedTitle: undefined, backendSyncedProjectName: undefined, backendSyncVersion: undefined, syncError: undefined, syncPending: undefined } : {}) };
        if (changed || !prev) await IOUtils.writeUTF8(file(id), chat.events.map(e => JSON.stringify({ ...mapEvent(e.event, refs.download), _syncId: e.id })).join("\n") + (chat.events.length ? "\n" : ""), { tmpPath: `${file(id)}.tmp` });
        next.push(s);
      }
      await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
      await IOUtils.writeUTF8(deletedFile, JSON.stringify(deleted), { tmpPath: `${deletedFile}.tmp` });
      await IOUtils.writeUTF8(index, JSON.stringify({ sessions: next }), { tmpPath: `${index}.tmp` });
      for (const s of all) if (!busy.has(s.id) && doc.chats[s.id]?.deleted) await IOUtils.remove(file(s.id), { ignoreAbsent: true });
      await IOUtils.remove(recoveryFile, { ignoreAbsent: true });
    }),
    flush: () => serial(async () => {}),
    clearAll: () => serial(async () => { for (const s of await readIndex()) await remove(s.id); }),

    deleteSession: (id: string) => serial(() => remove(id)),
  };
}

function missing(e: any): boolean { return e?.name === "NotFoundError" || e?.code === "ENOENT" || e?.message === "absent" || e?.becauseNoSuchFile; }
