import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isolated = await fs.mkdtemp(path.join(root, ".dev-chat-sync-"));
assert(path.resolve(isolated).startsWith(root + path.sep));
const profile = path.join(isolated, "profile"), data = path.join(isolated, "data"), cwd = path.join(isolated, "workspace");
for (const p of [profile, data, cwd, path.join(profile, "extensions")]) await fs.mkdir(p, { recursive: true });
let body = null, version = 0, directory = false;
const server = createServer(async (req, res) => {
  if (req.url.endsWith("/stage-b")) {
    const doc = JSON.parse(body), chat = doc.chats["gecko-sync-chat"];
    for (const event of [{ t: "user", id: "b-question", text: "B 的问题 BETA", chips: [] }, { t: "text", turn: "b-turn", delta: "B 的回答 BETA" }, { t: "turn_end", turn: "b-turn", stop: "end_turn" }]) chat.events.push({ id: randomUUID(), event });
    chat.session.updatedAt = Date.now(); body = JSON.stringify(doc); version++; res.writeHead(204).end(); return;
  }
  if (req.headers.authorization !== `Basic ${Buffer.from("reader:fixture-password").toString("base64")}`) { res.writeHead(401).end(); return; }
  if (req.method === "MKCOL") { directory = true; res.writeHead(201).end(); return; }
  if (req.method === "GET") { res.writeHead(body ? 200 : 404, body ? { ETag: `"${version}"`, "Content-Type": "application/json" } : {}); res.end(body || ""); return; }
  if (req.method === "PUT") {
    if (!directory) { req.socket.destroy(); return; }
    if ((req.headers["if-none-match"] === "*" && body) || (req.headers["if-match"] && req.headers["if-match"] !== `"${version}"`)) { res.writeHead(412).end(); return; }
    const chunks = []; for await (const c of req) chunks.push(c); body = Buffer.concat(chunks).toString(); version++; res.writeHead(201).end(); return;
  }
  res.writeHead(405).end();
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const url = `http://127.0.0.1:${server.address().port}/dav/`;
const fixture = path.join(isolated, "fixture.json"), output = path.join(isolated, "result.json");
await fs.writeFile(fixture, JSON.stringify({ profile, data, cwd, url }));
const prefs = { "extensions.zotero.useDataDir": true, "extensions.zotero.dataDir": data, "extensions.zotero.httpServer.enabled": false,
  "extensions.autoDisableScopes": 0, "extensions.enabledScopes": 15, "extensions.startupScanScopes": 15, "extensions.zotero.sync.autoSync": false,
  "extensions.zotero.firstRun2": false, "extensions.zotero.firstRunGuidance": false, "extensions.zotero.lastVersion": "10.0.7",
  "extensions.zotero.automaticScraperUpdates": false, "app.update.enabled": false,
  "extensions.zotero-chat.settings": JSON.stringify({ welcomed: true, autoResumePaper: false, appearance: { language: "zh-CN" } }) };
await fs.writeFile(path.join(profile, "user.js"), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
let proc;
try {
  execFileSync(process.execPath, ["scripts/build.mjs", "--dev"], { cwd: root, stdio: "inherit" });
  await fs.copyFile(path.join(root, "dist/zotero-agent.xpi"), path.join(profile, "extensions/chat@zotero-mcp.xpi"));
  proc = spawn(process.env.ZMC_ZOTERO_BIN || "D:\\Zotero\\zotero.exe", ["-no-remote", "--new-instance", "--profile", profile], { windowsHide: true, stdio: "ignore",
    env: { ...process.env, ZMC_DEFAULT_CHAT_FOLDER: cwd, ZMC_TEST_SCRIPT: path.join(root, "test/zotero/chat-sync.js"), ZMC_TEST_OUT: output, ZMC_SNAPSHOT_DIR: isolated, ZMC_SYNC_FIXTURE: fixture,
      CODEX_HOME: path.join(isolated, "codex"), CLAUDE_CONFIG_DIR: path.join(isolated, "claude") } });
  const deadline = Date.now() + 80000;
  let result;
  while (Date.now() < deadline) {
    try { result = JSON.parse(await fs.readFile(output, "utf8")); break; } catch (e) { if (e.code !== "ENOENT") throw e; }
    await new Promise(r => setTimeout(r, 400));
  }
  assert(result?.ok, JSON.stringify(result || { error: "Isolated Zotero timed out", isolated }));
  assert(!body.includes("local-native-binding"));
  await fs.mkdir(path.join(root, "test-output"), { recursive: true });
  await fs.writeFile(path.join(root, "test-output/chat-sync-xpi-report.json"), JSON.stringify({ ...result, isolated }, null, 2));
  console.log(JSON.stringify({ ...result, isolated }, null, 2));
} finally {
  if (proc && proc.exitCode === null) proc.kill();
  server.closeAllConnections(); await new Promise(r => server.close(r));
}
