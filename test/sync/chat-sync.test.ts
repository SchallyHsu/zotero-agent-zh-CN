import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStore } from "../../src/zotero/store.ts";
import { emptyDocument, encodeDocument, mergeDocuments, parseDocument, type SharedChat } from "../../src/sync/model.ts";
import { WebDAV } from "../../src/sync/webdav.ts";
import { continuationPrompt, transcriptText } from "../../src/sync/continuation.ts";
import { Chat } from "../../src/ui/chat.ts";
import { FakeHost } from "../../src/ui/fake-host.ts";
import { env } from "../../src/ui/dom.ts";
import type { ChatEvent, SavedSession, ZoteroRef } from "../../src/types.ts";

const logins: any[] = [];
Object.assign(globalThis, {
  Zotero: { logError() {}, HTTP: { async request(method: string, url: string, o: any) {
    assert.equal(o.followRedirects, false); assert.equal(o.logBodyLength, 0);
    const r = await fetch(url, { method, headers: o.headers, ...(o.body ? { body: o.body } : {}), redirect: "manual" });
    return { status: r.status, responseText: await r.text(), getResponseHeader: (n: string) => r.headers.get(n) };
  } } },
  Services: { uuid: { generateUUID: () => `{${randomUUID()}}` }, logins: {
    searchLoginsAsync: async (q: any) => logins.filter(l => l.origin === q.origin && l.httpRealm === q.httpRealm),
    removeLogin: (l: any) => logins.splice(logins.indexOf(l), 1), addLoginAsync: async (l: any) => { logins.push(l); },
  } },
  Components: { Constructor() { return class { origin: string; httpRealm: string; username: string; password: string;
    constructor(origin: string, _form: null, realm: string, username: string, password: string) { this.origin = origin; this.httpRealm = realm; this.username = username; this.password = password; }
  }; } }, Ci: { nsILoginInfo: {} },
  PathUtils: { join }, IOUtils: {
    readUTF8: (p: string) => fs.readFile(p, "utf8"), makeDirectory: (p: string) => fs.mkdir(p, { recursive: true }),
    async writeUTF8(p: string, s: string, o?: any) { if (o?.mode === "appendOrCreate") return fs.appendFile(p, s); if (o?.tmpPath) { await fs.writeFile(o.tmpPath, s); return fs.rename(o.tmpPath, p); } await fs.writeFile(p, s); },
    remove: (p: string, o: any) => fs.rm(p, { force: !!o?.ignoreAbsent, recursive: !!o?.recursive }),
  },
});
env.win = globalThis as unknown as typeof env.win;
const { acquireChatSync } = await import("../../src/zotero/chat-sync.ts");
const win = { btoa, setTimeout: (f: () => void, n: number) => setTimeout(f, n).unref(), clearTimeout, setInterval: (f: () => void, n: number) => setInterval(f, n).unref(), clearInterval };

async function server() {
  let body: string | null = null, version = 0, directory = false, offline = false, weak = false, collisions = 0;
  const requests: string[] = [];
  const app = createServer(async (req, res) => {
    requests.push(req.method!);
    if (offline) { res.writeHead(503).end(); return; }
    if (req.headers.authorization !== `Basic ${btoa("reader:fixture-password")}`) { res.writeHead(401).end(); return; }
    if (req.method === "MKCOL") { const code = directory ? 405 : 201; directory = true; res.writeHead(code).end(); return; }
    if (req.method === "GET") { res.writeHead(body ? 200 : 404, body ? { ETag: `${weak ? "W/" : ""}"${version}"` } : {}); res.end(body ?? ""); return; }
    if (req.method === "PUT") {
      if (!directory) { res.writeHead(409).end(); return; }
      if ((req.headers["if-none-match"] === "*" && body) || (req.headers["if-match"] && req.headers["if-match"] !== `"${version}"`)) { collisions++; res.writeHead(412).end(); return; }
      const chunks = []; for await (const c of req) chunks.push(c);
      body = Buffer.concat(chunks).toString(); version++; res.writeHead(201, { ETag: `"${version}"` }).end(); return;
    }
    res.writeHead(405).end();
  });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  const address = app.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}/dav/`, requests, doc: () => body ? parseDocument(body) : null, raw: () => body,
    offline: (v: boolean) => { offline = v; }, weak: (v: boolean) => { weak = v; }, collisions: () => collisions,
    corrupt: () => { body = '{"wrong":1}'; version++; }, close: () => new Promise<void>(r => { app.close(() => r()); app.closeAllConnections(); }) };
}

async function device(url: string, libraryID: number) {
  const dir = await fs.mkdtemp(join(tmpdir(), "zmc-chat-sync-"));
  const refs = { upload: (r: ZoteroRef) => ({ ...r, libraryID: 0, libraryKey: "user:42" }), download: (r: ZoteroRef) => ({ ...r, libraryID }) };
  const store = createStore(join(dir, "sessions"), refs), host = new FakeHost({ speed: 0, noHistory: true });
  await host.setSettings({ chatSync: { enabled: true, url, username: "reader" } });
  const cloud = acquireChatSync({ dir, win, store, settings: () => host.getSettings() });
  host.chatSync = cloud.api;
  host.sessions = store.sessions; host.saveSession = store.saveSession; host.loadEvents = store.loadEvents; host.appendEvent = store.appendEvent; host.deleteSession = store.deleteSession;
  host.currentPaper = () => ({ libraryID, itemKey: "PAPER001", title: "Shared paper" });
  await cloud.api.setPassword("fixture-password");
  const chat = new Chat({ host, onChange() {}, blockReason: () => null, turnEnded() {}, setupFailed() {}, sessionChanged() {}, shownChanged() {}, expand: async t => t });
  return { host, chat, store, cloud, async close() { await chat.reset(); cloud.release(); await fs.rm(dir, { recursive: true, force: true }); } };
}

async function send(d: Awaited<ReturnType<typeof device>>, question: string, answer: string) {
  d.host.sim.nextAnswer = answer;
  await d.chat.send(question, d.host.currentContext());
  await d.chat.refreshFromSync();
  assert.equal(d.chat.busy, false);
  assert.equal(d.cloud.api.status().state, "ok", d.cloud.api.status().message || "");
}

test("A→B→A continues with remote context, same chat id, local bindings and exact selections", async () => {
  const s = await server(), a = await device(s.url, 1), b = await device(s.url, 8);
  try {
    await send(a, "Remember the marker ALPHA", "ALPHA remembered");
    const id = a.chat.saved!.id, aNative = a.chat.saved!.agentSessionId;
    await b.cloud.api.sync();
    const imported = (await b.store.sessions())[0]!;
    assert.equal(imported.id, id); assert.equal(imported.paper?.libraryID, 8);
    assert.equal(imported.agentSessionId, ""); assert.equal(imported.cwd, "");
    await b.chat.load(imported);
    await send(b, "Add marker BETA", "BETA added");
    assert.match(b.host.sim.prompts.at(-1)!.text, /ALPHA remembered/);
    assert.notEqual(b.chat.saved!.agentSessionId, aNative);
    await send(a, "What did B add?", "It added BETA");
    assert.match(a.host.sim.prompts.at(-1)!.text, /BETA added/);
    assert.equal(a.chat.saved!.id, id);
    assert.notEqual(a.chat.saved!.agentSessionId, aNative, "stale native session was replaced");
    await b.chat.refreshFromSync();
    assert.match(transcriptText(await b.store.loadEvents(id)), /It added BETA/);
    const count = (await b.store.loadEvents(id)).length;
    await Promise.all([a.cloud.api.sync(), b.cloud.api.sync()]); await b.cloud.api.sync();
    assert.equal((await b.store.loadEvents(id)).length, count, "repeated sync does not duplicate deltas");
    assert.doesNotMatch(s.raw()!, /agentSessionId|backendProjectId|"cwd"|fixture-password/);
    assert(s.requests.includes("MKCOL"));
    const ev: ChatEvent = { t: "user", id: "selection", text: "Explain", chips: [{ id: "quote", kind: "selection", label: "Quote", text: "Exact quotation", ref: { libraryID: 1, itemKey: "PAPER001", pageIndex: 2, position: { pageIndex: 2, rects: [[1, 2, 3, 4]] } } }] };
    await a.store.appendEvent(a.chat.saved!, ev); await a.cloud.api.sync(); await b.cloud.api.sync();
    const quote = (await b.store.loadEvents(id)).find(e => e.t === "user" && e.id === "selection");
    assert(quote?.t === "user"); assert.equal(quote.chips[0]!.ref.libraryID, 8);
    assert.deepEqual(quote.chips[0]!.ref.position, { pageIndex: 2, rects: [[1, 2, 3, 4]] });
  } finally { await a.close(); await b.close(); await s.close(); }
});

test("offline continuation is retained and simultaneous appends preserve both branches", async () => {
  const s = await server(), a = await device(s.url, 1), b = await device(s.url, 2);
  try {
    await send(a, "Shared start", "Shared answer"); await b.cloud.api.sync(); await b.chat.load((await b.store.sessions())[0]!);
    s.offline(true);
    a.host.sim.nextAnswer = "Offline answer A"; b.host.sim.nextAnswer = "Offline answer B";
    await Promise.all([a.chat.send("Offline A", []), b.chat.send("Offline B", [])]);
    await Promise.all([a.chat.refreshFromSync(), b.chat.refreshFromSync()]);
    assert.equal(a.cloud.api.status().state, "error");
    s.offline(false);
    await Promise.all([a.cloud.api.sync(), b.cloud.api.sync()]);
    await Promise.all([a.cloud.api.sync(), b.cloud.api.sync()]);
    const cloud = s.doc()!;
    const chats = Object.values(cloud.chats).filter(c => !c.deleted);
    assert.equal(chats.length, 2);
    assert(chats.some(c => transcriptText(c.events.map(e => e.event)).includes("Offline answer A")));
    assert(chats.some(c => transcriptText(c.events.map(e => e.event)).includes("Offline answer B")));
    assert(chats.some(c => c.session.title.endsWith("[fork]")));
    assert.equal((await a.store.sessions()).length, 2); assert.equal((await b.store.sessions()).length, 2);
  } finally { await a.close(); await b.close(); await s.close(); }
});

test("remote deletion propagates; concurrent unsynced edits survive as a fork", async () => {
  const s = await server(), a = await device(s.url, 1), b = await device(s.url, 2);
  try {
    await send(a, "delete this chat", "old answer"); const id = a.chat.saved!.id;
    await b.cloud.api.sync(); const old = (await b.store.sessions())[0]!;
    await a.store.deleteSession(id); await a.cloud.api.sync();
    await b.store.appendEvent(old, { t: "user", id: "later", text: "unsynced edit", chips: [] });
    await b.cloud.api.sync(); await a.cloud.api.sync();
    assert(!(await a.store.sessions()).some(c => c.id === id));
    const fork = (await a.store.sessions())[0]!; assert(fork.title.endsWith("[fork]"));
    assert.match(transcriptText(await a.store.loadEvents(fork.id)), /unsynced edit/);
    await b.chat.load(old); assert(b.chat.tr.messages.some(m => m.role === "notice" && /deleted/.test(m.message)));
  } finally { await a.close(); await b.close(); await s.close(); }
});

test("active streamed rounds stay local; malformed remote data and weak ETags cannot erase local history", async () => {
  const s = await server(), a = await device(s.url, 1);
  try {
    await send(a, "Saved question", "Saved reply"); const saved = a.chat.saved!, before = await a.store.loadEvents(saved.id);
    a.cloud.api.beginTurn(saved.id);
    await a.store.appendEvent(saved, { t: "text", turn: "active", delta: "partial" });
    await a.cloud.api.sync();
    assert(!s.raw()!.includes("partial")); assert.equal((await a.store.loadEvents(saved.id)).length, before.length + 1);
    a.cloud.api.endTurn(saved.id);
    s.weak(true); await a.cloud.api.sync(); assert.match(a.cloud.api.status().message!, /ETag/);
    assert.equal((await a.store.loadEvents(saved.id)).length, before.length + 1);
    s.weak(false); s.corrupt(); await a.cloud.api.sync(); assert.match(a.cloud.api.status().message!, /Unsupported/);
    assert.equal((await a.store.loadEvents(saved.id)).length, before.length + 1);
  } finally { await a.close(); await s.close(); }
});

test("conditional creation retries a competing writer and never replaces a changed ETag", async () => {
  const s = await server();
  try {
    const dav = new WebDAV(s.url, async (method, url, headers, body) => {
      const r = await fetch(url, { method, headers: { ...headers, Authorization: `Basic ${btoa("reader:fixture-password")}` }, ...(body ? { body } : {}) });
      return { status: r.status, text: await r.text(), etag: r.headers.get("ETag") || undefined };
    });
    assert.equal(await dav.write(emptyDocument()), true);
    assert.equal(await dav.write(emptyDocument()), false);
    assert.equal(await dav.write(emptyDocument(), '"stale"'), false);
    assert.equal(s.collisions(), 2);
  } finally { await s.close(); }
});

test("divergent merges converge regardless of direction and repeat without making more forks", () => {
  const base: SavedSession = { id: "s1", title: "Original", backend: "codex", cwd: "", agentSessionId: "", updatedAt: 1 };
  const chat = (ids: string[]): SharedChat => ({ session: base, events: ids.map(id => ({ id, event: { t: "user", id, text: id, chips: [] } })) });
  const a = emptyDocument(), b = emptyDocument(); a.chats.s1 = chat(["common", "a"]); b.chats.s1 = chat(["common", "b"]);
  const ab = mergeDocuments(a, b), ba = mergeDocuments(b, a);
  assert.equal(encodeDocument(ab), encodeDocument(ba));
  assert.equal(encodeDocument(mergeDocuments(ab, ba)), encodeDocument(ab));
  assert.equal(Object.keys(ab.chats).length, 2);
});

test("replayed context omits private reasoning and approvals, and retains a path to long history", () => {
  const events: ChatEvent[] = [{ t: "user", id: "u", text: "Old question", chips: [] }, { t: "thought", turn: "t", delta: "private reasoning" }, { t: "text", turn: "t", delta: "Visible answer" }, { t: "turn_end", turn: "t", stop: "end_turn" }];
  const full = transcriptText(events); assert.match(full, /Old question/); assert.match(full, /Visible answer/); assert.doesNotMatch(full, /private reasoning/);
  assert.match(continuationPrompt(full, "/full.md", 5), /\/full\.md/);
});

test("an interrupted multi-file import recovers every branch from the local journal", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "zmc-sync-recovery-"));
  const store = createStore(dir);
  const s: SavedSession = { id: "recovery", title: "Recovery", backend: "codex", cwd: "local", agentSessionId: "local", updatedAt: 1 };
  const io = (globalThis as any).IOUtils, write = io.writeUTF8;
  try {
    await store.appendEvent(s, { t: "user", id: "old-user", text: "unsynced local content", chips: [] });
    const remote = emptyDocument();
    remote.chats.recovery = { session: { id: "recovery", title: "Recovery", backend: "codex", updatedAt: 2 }, events: [{ id: "0", event: { t: "user", id: "remote-user", text: "remote content", chips: [] } }] };
    io.writeUTF8 = async (p: string, text: string, options: any) => { if (p === join(dir, "index.json")) throw Error("simulated disk interruption"); return write(p, text, options); };
    await assert.rejects(store.importDocument(remote), /interruption/);
    io.writeUTF8 = write;
    const restarted = createStore(dir), recovered = await restarted.exportDocument();
    assert.equal(Object.values(recovered.chats).filter(c => !c.deleted).length, 2);
    assert(Object.values(recovered.chats).some(c => transcriptText(c.events.map(e => e.event)).includes("unsynced local content")));
    await restarted.importDocument(recovered);
    assert.equal((await restarted.sessions()).length, 2);
    await assert.rejects(fs.stat(join(dir, "sync-recovery.json")), { code: "ENOENT" });
  } finally { io.writeUTF8 = write; await fs.rm(dir, { recursive: true, force: true }); }
});

test("a shared-context read failure never sends a contextless continuation", async () => {
  const s = await server(), a = await device(s.url, 1), b = await device(s.url, 2);
  try {
    await send(a, "Start", "First answer"); await b.cloud.api.sync(); await b.chat.load((await b.store.sessions())[0]!);
    b.cloud.api.continuation = async () => { throw Error("context unavailable"); };
    await b.chat.send("Continue", []);
    assert.equal(b.host.sim.prompts.length, 0);
    assert.equal(b.chat.busy, false);
    assert(b.chat.tr.messages.some(m => m.role === "notice" && m.message === "context unavailable"));
  } finally { await a.close(); await b.close(); await s.close(); }
});
