// Chat history: <dir>/index.json (the list) and <dir>/<id>.jsonl (one ChatEvent per line, replayed through the same
// reducer that rendered it live). Lives in the profile, not the Zotero data dir, so it is never synced or backed up with the library.
import type { ChatEvent, SavedSession } from "../types.ts";
import { DEFAULT_PROJECT, paperFromChips } from "../ui/session-model.ts";
const chains = new Map<string, Promise<unknown>>();

export function createStore(dir: string) {
  const index = PathUtils.join(dir, "index.json");
  const file = (id: string) => PathUtils.join(dir, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.jsonl`);
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
    } catch {
      return [];
    }
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
        return text.split("\n").filter(Boolean).flatMap((l: string) => { try { return [JSON.parse(l) as ChatEvent]; } catch { return []; } });
      } catch {
        return [];
      }
    },

    appendEvent: (session: SavedSession, ev: ChatEvent) => serial(async () => {
      await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
      await IOUtils.writeUTF8(file(session.id), JSON.stringify(ev) + "\n", { mode: "appendOrCreate" });
      const current = (await readIndex()).find((s) => s.id === session.id);
      await save({ ...session, ...(current ? { title: current.title, titleUpdatedAt: current.titleUpdatedAt, agentSessionId: current.agentSessionId || session.agentSessionId, backendProjectId: current.backendProjectId, backendSyncedTitle: current.backendSyncedTitle, backendSyncedProjectName: current.backendSyncedProjectName, backendSyncVersion: current.backendSyncVersion, syncPending: current.syncPending, syncError: current.syncError } : {}), updatedAt: Date.now() });
    }),

    clearAll: () => serial(async () => { await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true }); }),

    deleteSession: (id: string) => serial(async () => {
      await IOUtils.remove(file(id), { ignoreAbsent: true });
      await IOUtils.writeUTF8(index, JSON.stringify({ sessions: (await readIndex()).filter((s) => s.id !== id) }));
    }),
  };
}
