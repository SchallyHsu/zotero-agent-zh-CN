// Portable chat snapshots. The remote document contains no native session ids, working directories or credentials.
import type { ChatEvent, SavedSession, ZoteroRef } from "../types.ts";

export type SharedSession = Pick<SavedSession, "id" | "title" | "titleUpdatedAt" | "backend" | "updatedAt" | "projectName" | "paper">;
export interface SharedEvent { id: string; event: ChatEvent }
export interface SharedChat { session: SharedSession; events: SharedEvent[]; deleted?: string[] }
export interface SyncDocument { format: "zotero-agent-chat"; version: 1; chats: Record<string, SharedChat> }
export const emptyDocument = (): SyncDocument => ({ format: "zotero-agent-chat", version: 1, chats: Object.create(null) });

/** Stable legacy ids survive the migration of a copied profile on several devices. */
export function legacyId(session: string, index: number, event: ChatEvent): string {
  let hash = 2166136261;
  for (const ch of JSON.stringify(event)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return `legacy-${session}-${index}-${(hash >>> 0).toString(16)}`;
}

export function mapEvent(event: ChatEvent, map: (r: ZoteroRef) => ZoteroRef): ChatEvent {
  return event.t === "user" ? { ...event, chips: event.chips.map(c => ({ ...c, ref: map(c.ref) })) } : event;
}

export function shareSession(s: SavedSession, map: (r: ZoteroRef) => ZoteroRef): SharedSession {
  const ref = s.paper ? map(s.paper) : undefined;
  return { id: s.id, title: s.title, backend: s.backend, updatedAt: s.updatedAt,
    ...(s.titleUpdatedAt !== undefined ? { titleUpdatedAt: s.titleUpdatedAt } : {}),
    ...(s.projectName ? { projectName: s.projectName } : {}),
    ...(s.paper && ref ? { paper: { libraryID: ref.libraryID, ...(ref.libraryKey ? { libraryKey: ref.libraryKey } : {}), itemKey: s.paper.itemKey, title: s.paper.title } } : {}) };
}

export function parseDocument(text: string): SyncDocument {
  checkSize(text);
  const d = JSON.parse(text);
  if (d?.format !== "zotero-agent-chat" || d.version !== 1 || !d.chats || typeof d.chats !== "object" || Array.isArray(d.chats)) throw Error("Unsupported chat sync file. Local chats were kept.");
  const result = emptyDocument();
  for (const [id, c] of Object.entries(d.chats) as [string, any][]) {
    if (!/^[A-Za-z0-9_-]{1,240}$/.test(id) || c?.session?.id !== id || typeof c.session.title !== "string" || !["codex", "claude-code", "pi", "antigravity", "deepseek-harness"].includes(c.session.backend)
      || !Number.isFinite(c.session.updatedAt) || !Array.isArray(c.events) || (c.deleted !== undefined && (!Array.isArray(c.deleted) || c.deleted.some((x: unknown) => typeof x !== "string")))) throw Error("Invalid chat sync record. Local chats were kept.");
    const seen = new Set<string>();
    for (const e of c.events) {
      if (typeof e?.id !== "string" || !/^[A-Za-z0-9_-]{1,300}$/.test(e.id) || seen.has(e.id) || !validEvent(e.event)) throw Error("Invalid chat sync event. Local chats were kept.");
      seen.add(e.id);
    }
    // Explicit allowlist also strips accidentally uploaded device bindings from older clients.
    result.chats[id] = { session: shareSession(c.session, r => ({ ...r, libraryID: 0 })), events: c.events,
      ...(c.deleted ? { deleted: [...new Set<string>(c.deleted)] } : {}) };
  }
  return result;
}

export function checkSize(text: string): void {
  let bytes = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (bytes > 32 * 1024 * 1024) throw Error("Chat sync file exceeds 32 MB.");
  }
}

function validEvent(e: any): boolean {
  if (!e || typeof e !== "object") return false;
  if (e.t === "user") return typeof e.id === "string" && typeof e.text === "string" && Array.isArray(e.chips) && e.chips.every((c: any) => typeof c?.label === "string" && c.ref && typeof c.ref.libraryID === "number");
  if (e.t === "notice") return typeof e.message === "string" && ["info", "warn", "error"].includes(e.level);
  if (typeof e.turn !== "string") return false;
  if (e.t === "text" || e.t === "thought") return typeof e.delta === "string";
  if (e.t === "turn_start") return true;
  if (e.t === "turn_end") return ["end_turn", "cancelled", "max_tokens", "refusal", "error"].includes(e.stop);
  if (e.t === "tool") return typeof e.id === "string" && typeof e.title === "string";
  if (e.t === "permission") return typeof e.id === "string" && typeof e.title === "string" && Array.isArray(e.options);
  if (e.t === "plan") return Array.isArray(e.entries);
  return false;
}

const meta = (a: SharedSession, b: SharedSession): SharedSession => {
  const title = (a.titleUpdatedAt ?? 0) === (b.titleUpdatedAt ?? 0) ? (a.title < b.title ? a : b) : (a.titleUpdatedAt ?? 0) > (b.titleUpdatedAt ?? 0) ? a : b;
  return { ...a, title: title.title, ...(title.titleUpdatedAt !== undefined ? { titleUpdatedAt: title.titleUpdatedAt } : {}), updatedAt: Math.max(a.updatedAt, b.updatedAt) };
};

/** Prefix histories merge without duplicating deltas. Divergence preserves a complete separate branch. */
export function mergeDocuments(a: SyncDocument, b: SyncDocument): SyncDocument {
  const out = emptyDocument();
  const queue = [...Object.values(a.chats), ...Object.values(b.chats)];
  while (queue.length) {
    const incoming = queue.shift()!;
    const id = incoming.session.id, prev = out.chats[id];
    if (!prev) { out.chats[id] = JSON.parse(JSON.stringify(incoming)); continue; }
    if (prev.deleted || incoming.deleted) {
      const deleted = [...new Set([...(prev.deleted ?? []), ...(incoming.deleted ?? [])])].sort();
      out.chats[id] = { session: meta(prev.session, incoming.session), events: [], deleted };
      for (const c of [prev, incoming]) if (!c.deleted && c.events.some(e => !deleted.includes(e.id))) {
        const first = c.events.find(e => !deleted.includes(e.id))!;
        queue.push(fork(c, first.id));
      }
      continue;
    }
    let n = 0;
    while (n < prev.events.length && n < incoming.events.length && prev.events[n]!.id === incoming.events[n]!.id) {
      if (JSON.stringify(prev.events[n]!.event) !== JSON.stringify(incoming.events[n]!.event)) throw Error("Chat sync event identity collision. Local chats were kept.");
      n++;
    }
    if (n === Math.min(prev.events.length, incoming.events.length)) {
      const longer = prev.events.length >= incoming.events.length ? prev : incoming;
      out.chats[id] = { ...longer, session: meta(longer.session, meta(prev.session, incoming.session)) };
    } else {
      const winner = prev.events[n]!.id < incoming.events[n]!.id ? prev : incoming;
      const loser = winner === prev ? incoming : prev;
      out.chats[id] = { ...winner, session: meta(winner.session, meta(prev.session, incoming.session)) };
      queue.push(fork(loser, loser.events[n]!.id));
    }
  }
  return out;
}

function fork(chat: SharedChat, eventId: string): SharedChat {
  // UUID for new records; legacy ids may include the root id so use a bounded suffix.
  const suffix = eventId.slice(-70);
  const id = `${chat.session.id.slice(0, 160)}_fork_${suffix}`;
  return { session: { ...chat.session, id, title: `${chat.session.title.replace(/ \[fork\]$/, "")} [fork]` }, events: chat.events };
}

/** Stable object order avoids needless PUTs and makes cloud snapshots reviewable. */
export function encodeDocument(doc: SyncDocument): string {
  return JSON.stringify({ ...doc, chats: Object.fromEntries(Object.entries(doc.chats).sort(([a], [b]) => a.localeCompare(b))) });
}
