import type { ContextChip, PaperIdentity, SavedSession } from "../types.ts";

export const DEFAULT_PROJECT = "Zotero Agent";
export const paperKey = (p: PaperIdentity | undefined | null): string => p ? `${p.libraryID}:${p.itemKey}` : "";

/** Prefer the reader; several library selections must not bind a chat to an arbitrary paper. */
export function paperFromChips(chips: Pick<ContextChip, "kind" | "ref" | "label">[]): PaperIdentity | null {
  const reader = chips.find((c) => c.kind === "reader");
  const items = chips.filter((c) => c.kind === "item");
  const c = reader ?? (items.length === 1 ? items[0] : undefined);
  return c?.ref.itemKey ? { libraryID: c.ref.libraryID, itemKey: c.ref.itemKey, title: c.label } : null;
}

export function latestPaperSession(sessions: SavedSession[], paper: PaperIdentity, backend: SavedSession["backend"]): SavedSession | undefined {
  return sessions.filter((s) => s.backend === backend && paperKey(s.paper) === paperKey(paper))
    .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt))[0];
}

/** A display name is never a path; use a collision-resistant safe component on every platform. */
export function projectFolderName(name: string): string {
  const raw = name.trim() || DEFAULT_PROJECT;
  const safe = raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").slice(0, 100);
  if (safe === raw && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) && safe !== "." && safe !== "..") return safe;
  let hash = 2166136261;
  for (const c of raw) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return `${safe || "project"}-${(hash >>> 0).toString(16)}`;
}
