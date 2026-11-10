import type { SettingsHost } from "../types.ts";
import { h, errMessage } from "./dom.ts";
import { hint, section, switchRow } from "./settings-parts.ts";
import { syncURLs } from "../sync/webdav.ts";

export const SYNC_LABELS = { off: "Chat sync is off", pending: "Chats waiting to sync", syncing: "Syncing chats…", ok: "Chats synced", error: "Chat sync needs attention" };

export function syncCard(host: SettingsHost, rerender: () => void): () => HTMLElement {
  let draft: { enabled: boolean; url: string; username: string } | undefined;
  let password = "", busy = false, message = "", hasPassword: boolean | undefined, seenConfig = "";
  return () => {
    const savedConfig = JSON.stringify(host.getSettings().chatSync);
    if (!busy && savedConfig !== seenConfig) { draft = undefined; seenConfig = savedConfig; password = ""; hasPassword = undefined; message = ""; }
    draft ??= { enabled: false, url: "", username: "", ...host.getSettings().chatSync };
    const current = draft;
    if (hasPassword === undefined && host.chatSync) {
      hasPassword = false;
      void host.chatSync.hasPassword().then(has => { hasPassword = has; rerender(); }).catch(() => {});
    }
    const field = (label: string, key: "url" | "username" | "password", value: string) => h("label.field", null,
      h("span.field__l", null, label), h("input.input", { type: key === "password" ? "password" : key === "url" ? "url" : "text", value,
        "aria-label": label, autocomplete: key === "password" ? "new-password" : "off", dataset: { fid: `chat-sync-${key}` },
        placeholder: key === "password" && hasPassword ? "Password saved" : key === "url" ? "https://example.com/dav/" : "",
        oninput: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (key === "password") password = v; else { current[key] = v; if (key === "url") hasPassword = false; } } }));
    const apply = async () => {
      if (!host.chatSync || busy) return;
      busy = true; message = ""; rerender();
      try {
        if (current.enabled || current.url.trim()) { try { syncURLs(current.url); } catch { throw Error("Enter a valid WebDAV folder URL without credentials or query parameters."); } }
        await host.setSettings({ chatSync: { ...current, url: current.url.trim() } });
        if (password) { await host.chatSync.setPassword(password); password = ""; hasPassword = true; }
        await host.chatSync.sync();
        message = "";
      } catch (e) { message = errMessage(e); }
      finally { busy = false; rerender(); }
    };
    const status = host.chatSync?.status();
    const card = section("Chat sync", "Continue the same conversation across your computers using WebDAV.",
      switchRow("Sync chats across devices", "Save these settings on each device using the same WebDAV folder.", current.enabled, on => { current.enabled = on; rerender(); }),
      field("WebDAV folder URL", "url", current.url), field("WebDAV username", "username", current.username), field("WebDAV password", "password", password),
      h("div.datarow", null,
        h("button.btn.btn--sm", { type: "button", disabled: busy || !host.chatSync, onclick: () => void apply() }, busy ? "Syncing chats…" : "Save and sync"),
        h("button.btn.btn--sm", { type: "button", disabled: busy || !host.chatSync || !host.getSettings().chatSync?.enabled, onclick: () => { if (!host.chatSync) return; busy = true; message = ""; rerender(); void host.chatSync.sync().finally(() => { busy = false; rerender(); }); } }, "Sync now")),
      h("p.sec__hint", { role: "status", "aria-live": "polite" }, message || status?.message || SYNC_LABELS[status?.state || "off"]),
      hint("Chat text, tool results and paper references are uploaded to this WebDAV service. Passwords and native session bindings stay on each device."),
      hint("Complete replies sync automatically, on return to the window and before sending. Offline changes stay local until reconnection. Concurrent conversations are preserved in History with [fork]."));
    card.dataset.chatSync = "true";
    return card;
  };
}
