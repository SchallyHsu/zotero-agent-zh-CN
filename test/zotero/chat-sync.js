// Real Gecko, XPI, login manager and disk store. Only a loopback WebDAV fixture is contacted.
async function main(ctx) {
  const { Zotero, IOUtils, PathUtils, win } = ctx;
  const f = JSON.parse(await IOUtils.readUTF8(ctx.env("ZMC_SYNC_FIXTURE")));
  const check = (x, why) => { if (!x) throw Error(why); };
  check(PathUtils.normalize(Zotero.Profile.dir) === PathUtils.normalize(f.profile), "Expected isolated profile");
  const panel = ctx.plugin.panel(), host = panel.host;
  check(typeof win.crypto.randomUUID === "function", "Cross-device UUID support in Gecko");
  host.runtime.start = async o => ({ backend: o.backend, sessionId: "synthetic-local-session", supportsImages: false, canCompact: false,
    models: () => [], modes: () => [], efforts: () => [], currentModel() {}, defaultModel() {}, currentMode() {}, currentEffort() {},
    on: () => () => {}, close: async () => {}, prompt: async () => { throw Error("No inference permitted in this fixture"); } });
  host.runtime.accountUsage = async () => ({ status: "unsupported", fetchedAt: Date.now(), windows: [] });
  host.runtime.catalog = async () => ({ models: [], modes: [], efforts: [] });
  host.runtime.detect = async () => [];
  host.doctor = async () => [];
  host.syncSession = async s => s;
  await host.setSettings({ autoResumePaper: false, chatSync: { enabled: true, url: f.url, username: "reader" } });
  await host.chatSync.setPassword("fixture-password");
  check(await host.chatSync.hasPassword(), "Password stored in login manager");
  const session = { id: "gecko-sync-chat", title: "跨设备同步验证", backend: "claude-code", cwd: f.cwd, agentSessionId: "local-native-binding", updatedAt: Date.now(), projectName: "同步验证" };
  await host.saveSession(session);
  await host.appendEvent(session, { t: "user", id: "a-question", text: "A 的问题 ALPHA", chips: [] });
  await host.appendEvent(session, { t: "text", turn: "a-turn", delta: "A 的回答 ALPHA" });
  await host.appendEvent(session, { t: "turn_end", turn: "a-turn", stop: "end_turn" });
  await host.chatSync.sync();
  check(host.chatSync.status().state === "ok", "First sync: " + JSON.stringify(host.chatSync.status()));
  await Zotero.HTTP.request("POST", f.url + "stage-b", { successCodes: [204] });
  await host.chatSync.sync();
  check(host.chatSync.status().state === "ok", "Import sync: " + JSON.stringify(host.chatSync.status()));
  const imported = (await host.sessions()).find(s => s.id === session.id);
  check(imported.agentSessionId === "" && imported.cwd === "" && imported.needsContextReplay, "Remote round invalidates local native binding");
  const context = await host.chatSync.continuation(session.id);
  check(context.includes("A 的回答 ALPHA") && context.includes("B 的回答 BETA"), "Continuation includes both devices");
  const n = (await host.loadEvents(session.id)).length;
  await host.chatSync.sync(); check((await host.loadEvents(session.id)).length === n, "Repeated sync is idempotent");
  ctx.plugin.windows.get(win).show(); await ctx.resize(1280, 900);
  const root = win.document.getElementById("zmc-root").shadowRoot;
  const settled = win.document.createElementNS("http://www.w3.org/1999/xhtml", "style");
  settled.textContent = ".zmc *, .zmc *::before, .zmc *::after { animation: none !important; transition: none !important; }";
  root.append(settled);
  const history = [...root.querySelectorAll("button")].find(b => /^(History|历史对话)$/.test(b.getAttribute("aria-label") || ""));
  history.click();
  const row = await ctx.waitFor(() => [...root.querySelectorAll(".hrow__main")].find(b => b.textContent.includes(session.title)), "shared history");
  row.click();
  await ctx.waitFor(() => root.textContent.includes("B 的回答 BETA"), "remote answer displayed");
  await ctx.snapshot("chat-sync-history");
  const settings = [...root.querySelectorAll("button")].find(b => /^(Settings|设置)$/.test(b.getAttribute("aria-label") || ""));
  settings.click();
  await ctx.waitFor(() => root.querySelector("[data-chat-sync]"), "chat sync settings");
  await ctx.sleep(400);
  const card = root.querySelector("[data-chat-sync]"); card.scrollIntoView({ block: "start" });
  check(card.getBoundingClientRect().height > 0, "Sync settings have a visible layout");
  await ctx.sleep(1200); await ctx.snapshot("chat-sync-settings");
  check(card.textContent.includes("聊天同步"), "Chinese sync settings");
  check(!JSON.stringify(host.getSettings()).includes("fixture-password"), "Password excluded from preferences");
  return { realGeckoWebDAV: true, loginManager: true, remoteImport: true, contextFromBothDevices: true, idempotent: true, settings: true, modelInference: false };
}
