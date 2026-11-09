// Real packaged-XPI verification in a new profile and library under this repository.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { writeFileSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isolated = await fs.mkdtemp(path.join(root, ".dev-selection-"));
assert(path.resolve(isolated).startsWith(root + path.sep));
const profile = path.join(isolated, "profile"), data = path.join(isolated, "data"), cwd = path.join(isolated, "workspace");
for (const p of [profile, data, cwd, path.join(profile, "extensions")]) await fs.mkdir(p, { recursive: true });
// Reuse the upstream deterministic PDF generator, without running its macOS-specific launcher.
const dev = await fs.readFile(path.join(root, "scripts/dev.mjs"), "utf8");
const makePdf = dev.slice(dev.indexOf("function makePdf(path) {"), dev.indexOf("const testPdf ="))
  .replace('"Assigning a professional destination would increase pay in both groups,"', '"The selected passage appears twice in this test document."')
  .replace('"Thus, the disparity in class destinations does not explain the pay disparity."', '"The selected passage appears twice in this test document."');
const pdf = path.join(isolated, "selection.pdf");
vm.runInNewContext(makePdf + "\nmakePdf(pdf);", { writeFileSync, pdf });
const fixtureFile = path.join(isolated, "fixture.json");
await fs.writeFile(fixtureFile, JSON.stringify({ profile, data, cwd, pdf }));
const prefs = {
  "extensions.zotero.useDataDir": true, "extensions.zotero.dataDir": data,
  "extensions.zotero.httpServer.port": 0, "extensions.zotero.httpServer.enabled": false,
  "extensions.autoDisableScopes": 0, "extensions.enabledScopes": 15, "extensions.startupScanScopes": 15,
  "extensions.zotero.sync.autoSync": false, "extensions.zotero.firstRun2": false, "extensions.zotero.firstRunGuidance": false,
  "extensions.zotero.lastVersion": "10.0.7", "extensions.zotero.automaticScraperUpdates": false, "app.update.enabled": false,
  "extensions.zotero-chat.settings": JSON.stringify({ welcomed: true, autoResumePaper: false, appearance: { language: "zh-CN" } }),
};
await fs.writeFile(path.join(profile, "user.js"), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n"));
execFileSync(process.execPath, ["scripts/build.mjs", "--dev"], { cwd: root, stdio: "inherit" });
await fs.copyFile(path.join(root, "dist/zotero-agent.xpi"), path.join(profile, "extensions/chat@zotero-mcp.xpi"));
const output = path.join(isolated, "result.json");
const executable = process.env.ZMC_ZOTERO_BIN || (process.platform === "win32" ? "D:\\Zotero\\zotero.exe" : "/Applications/Zotero.app/Contents/MacOS/zotero");
const proc = spawn(executable, ["-no-remote", "--new-instance", "--profile", profile], { windowsHide: true, stdio: "ignore",
  env: { ...process.env, ZMC_DEFAULT_CHAT_FOLDER: cwd, ZMC_TEST_SCRIPT: path.join(root, "test/zotero/selection.js"), ZMC_TEST_OUT: output,
    ZMC_SNAPSHOT_DIR: isolated, ZMC_SELECTION_FIXTURES: fixtureFile, CODEX_HOME: path.join(isolated, "codex"), CLAUDE_CONFIG_DIR: path.join(isolated, "claude") } });
const deadline = Date.now() + 90000;
let result;
do {
  try { result = JSON.parse(await fs.readFile(output, "utf8")); break; } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (proc.exitCode !== null && proc.exitCode !== 0) throw Error(`Isolated Zotero exited with ${proc.exitCode}`);
  await new Promise(r => setTimeout(r, 400));
} while (Date.now() < deadline);
assert(result?.ok, JSON.stringify(result || { error: "Isolated Zotero timed out", isolated }));
console.log(JSON.stringify({ ...result, isolated }, null, 2));
