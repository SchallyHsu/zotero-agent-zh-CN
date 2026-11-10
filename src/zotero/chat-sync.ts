import type { ChatSyncHost, ChatSyncStatus, PanelSettings, ZoteroRef } from "../types.ts";
import { encodeDocument, mergeDocuments } from "../sync/model.ts";
import { WebDAV, type Request } from "../sync/webdav.ts";
import { continuationPrompt, transcriptText } from "../sync/continuation.ts";
import { getSyncPassword, setSyncPassword } from "./keychain.ts";
import type { createStore } from "./store.ts";

/** libraryID is local to a Zotero installation. Only account/group identities go over the wire. */
export function libraryKey(id: number): string {
  const lib = Zotero.Libraries.get(id);
  if (lib?.libraryType === "group") return `group:${lib.groupID}`;
  if (id === Zotero.Libraries.userLibraryID) return `user:${Zotero.Users.getCurrentUserID() || "local"}`;
  return `unavailable:${id}`;
}
export const syncRefs = {
  upload(r: ZoteroRef): ZoteroRef { return { ...r, libraryID: 0, libraryKey: r.libraryKey || libraryKey(r.libraryID) }; },
  download(r: ZoteroRef): ZoteroRef {
    if (!r.libraryKey) return { ...r, libraryID: -1 };
    const lib = Zotero.Libraries.getAll().find((l: any) => libraryKey(l.libraryID) === r.libraryKey && r.libraryKey !== "user:local");
    return { ...r, libraryID: lib?.libraryID ?? -1 };
  },
};

type Store = ReturnType<typeof createStore>;
interface SharedService { api: ChatSyncHost; refs: number; dirty(): void; configure(force?: boolean): void; stop(): void }
const registry: Map<string, SharedService> = (Zotero.__zmcChatSync ??= new Map());

export function acquireChatSync(o: { dir: string; win: any; store: Store; settings(): PanelSettings }) {
  let service = registry.get(o.dir);
  if (!service) {
    service = createService(o);
    registry.set(o.dir, service);
  }
  service.refs++;
  const s = service;
  return { api: s.api, dirty: () => s.dirty(), configure: () => s.configure(), release() { if (--s.refs === 0) { s.stop(); registry.delete(o.dir); } } };
}

function createService(o: { dir: string; win: any; store: Store; settings(): PanelSettings }): SharedService {
  let status: ChatSyncStatus = { state: "off" }, stopped = false, pending = false, inFlight: Promise<void> | undefined, configVersion = 0, flightVersion = 0, debounce: number | undefined, seenConfig = "";
  const listeners = new Set<() => void>();
  const emit = () => { for (const f of [...listeners]) try { f(); } catch (e) { Zotero.logError(e); } };
  const config = () => o.settings().chatSync;
  const set = (next: ChatSyncStatus) => { status = next; emit(); };
  const request = (password: string, username: string): Request => async (method, url, headers, body) => {
    let r;
    try {
      const auth = o.win.btoa(unescape(encodeURIComponent(`${username}:${password}`)));
      r = await Zotero.HTTP.request(method, url, { headers: { ...headers, Authorization: `Basic ${auth}` }, body, responseType: "text", timeout: 10000, logBodyLength: 0, noCache: true, successCodes: false, followRedirects: false, errorDelayIntervals: [] });
    } catch { throw Error("WebDAV connection failed. Local chats are waiting to sync."); }
    // Never follow a redirect while carrying the WebDAV password to another origin.
    return { status: r.status, text: r.responseText || "", etag: r.getResponseHeader("ETag") || undefined };
  };
  const api: ChatSyncHost = {
    status: () => ({ ...status }),
    subscribe(f) { listeners.add(f); return () => { listeners.delete(f); }; },
    async hasPassword() { const c = config(); return !!(c && await getSyncPassword(c.url, c.username)); },
    async setPassword(password) {
      const c = config(); if (!c?.url) throw Error("Enter the WebDAV URL first.");
      await setSyncPassword(c.url, c.username, password); service.configure(true);
    },
    beginTurn: id => { o.store.beginTurn(id); },
    endTurn: id => { o.store.endTurn(id); service.dirty(); },
    async continuation(id) {
      const text = transcriptText(await o.store.loadEvents(id));
      if (!text) return "";
      const dir = PathUtils.join(o.dir, "continuations"), path = PathUtils.join(dir, `${id.replace(/[^A-Za-z0-9_-]/g, "_")}.md`);
      await IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true });
      await IOUtils.writeUTF8(path, text, { tmpPath: `${path}.tmp` });
      return continuationPrompt(text, path);
    },
    sync() {
      if (stopped || !config()?.enabled) return Promise.resolve();
      if (inFlight) return flightVersion === configVersion ? inFlight : inFlight.then(() => api.sync());
      const c = { ...config()! }, version = configVersion;
      flightVersion = version;
      const valid = () => !stopped && configVersion === version && !!config()?.enabled;
      inFlight = (async () => {
        pending = false;
        let success = false;
        set({ ...status, state: "syncing", message: undefined });
        try {
          const password = await getSyncPassword(c.url, c.username);
          if (!password) throw Error("Save the WebDAV password to enable chat sync.");
          if (!valid()) return;
          const dav = new WebDAV(c.url, request(password, c.username));
          for (let n = 0; n < 4; n++) {
            const remote = await dav.read();
            if (!valid()) return;
            const local = await o.store.exportDocument(), merged = mergeDocuments(remote.doc, local);
            if (!valid()) return;
            if (encodeDocument(merged) !== encodeDocument(remote.doc) && !await dav.write(merged, remote.etag)) continue;
            if (!valid()) return;
            await o.store.importDocument(merged);
            if (!valid()) return;
            pending = encodeDocument(mergeDocuments(merged, await o.store.exportDocument())) !== encodeDocument(merged);
            success = true;
            set({ state: pending ? "pending" : "ok", lastSyncedAt: Date.now() });
            return;
          }
          throw Error("Chat sync is busy on another device. Retrying automatically.");
        } catch (e) { if (valid()) set({ ...status, state: "error", message: String((e as Error).message || e) }); }
        finally { if (!success) pending = false; }
      })().finally(() => { inFlight = undefined; if (pending && valid()) service.dirty(); });
      return inFlight;
    },
  };
  const interval = o.win.setInterval(() => { void api.sync(); }, 30000);
  const service: SharedService = {
    api, refs: 0,
    dirty() {
      pending = true;
      if (!config()?.enabled || stopped) return;
      if (status.state !== "syncing") set({ ...status, state: "pending" });
      o.win.clearTimeout(debounce);
      debounce = o.win.setTimeout(() => { void api.sync(); }, 700);
    },
    configure(force = false) { const key = JSON.stringify(config()); if (!force && key === seenConfig) return; seenConfig = key; configVersion++; pending = false; set({ state: config()?.enabled ? "pending" : "off" }); if (config()?.enabled) service.dirty(); },
    stop() { stopped = true; o.win.clearInterval(interval); o.win.clearTimeout(debounce); listeners.clear(); },
  };
  service.configure();
  return service;
}
