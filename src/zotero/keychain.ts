// API keys live in the OS keychain through Zotero's login manager, never in prefs.js.
import type { BackendId } from "../types.ts";

const ORIGIN = "chrome://zotero-chat";

/** The variable each backend reads its key from. pi has none: it runs on whatever the user configured for it. */
export const API_KEY_ENV: Partial<Record<BackendId, string>> = {
  "claude-code": "ANTHROPIC_API_KEY",
  codex: "OPENAI_API_KEY",
  antigravity: "GEMINI_API_KEY",
};

const realm = (backend: BackendId) => `${backend} API key`;

async function find(backend: BackendId): Promise<any | null> {
  const logins = await Services.logins.searchLoginsAsync({ origin: ORIGIN, httpRealm: realm(backend) });
  return logins[0] ?? null;
}

export async function getApiKey(backend: BackendId): Promise<string | null> {
  return (await find(backend))?.password ?? null;
}

export async function setApiKey(backend: BackendId, key: string | null): Promise<void> {
  const existing = await find(backend);
  if (existing) Services.logins.removeLogin(existing);
  if (!key) return;
  const LoginInfo = Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Ci.nsILoginInfo, "init");
  await Services.logins.addLoginAsync(new LoginInfo(ORIGIN, null, realm(backend), "api-key", key, "", ""));
}

const syncRealm = (url: string) => `Chat WebDAV ${url.trim().replace(/\/+$/, "")}`;
export async function getSyncPassword(url: string, username: string): Promise<string | null> {
  const logins = await Services.logins.searchLoginsAsync({ origin: ORIGIN, httpRealm: syncRealm(url) });
  return logins.find((l: any) => l.username === username)?.password ?? null;
}
export async function setSyncPassword(url: string, username: string, password: string): Promise<void> {
  const realm = syncRealm(url);
  const logins = await Services.logins.searchLoginsAsync({ origin: ORIGIN, httpRealm: realm });
  for (const login of logins) if (login.username === username) Services.logins.removeLogin(login);
  if (!password) return;
  const LoginInfo = Components.Constructor("@mozilla.org/login-manager/loginInfo;1", Ci.nsILoginInfo, "init");
  await Services.logins.addLoginAsync(new LoginInfo(ORIGIN, null, realm, username, password, "", ""));
}
