// Full packaged PanelHost integration in real Zotero/Gecko on Windows. All
// libraries, native homes, histories and project queues are isolated fixtures.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createNodeSpawner } from '../test/node-spawner.ts';
import { findBinary } from '../src/agent/env.ts';
import { shimTarget } from '../src/agent/windows.ts';
import { JsonRpcPeer } from '../src/agent/jsonrpc.ts';
import { prepareSession } from '../assets/antigravity-project-integration.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isolated = await fs.mkdtemp(path.join(root, '.dev-xpi-projects-'));
assert(path.resolve(isolated).startsWith(root + path.sep));
const profile = path.join(isolated, 'profile'), data = path.join(isolated, 'data'), cwd = path.join(isolated, 'Zotero Agent');
for (const dir of [profile, data, cwd, path.join(profile, 'extensions')]) await fs.mkdir(dir, { recursive: true });
const codexHome = path.join(isolated, 'codex'), gemini = path.join(isolated, 'gemini'), claude = path.join(isolated, 'claude'), dsh = path.join(isolated, 'dsh');
await fs.mkdir(codexHome); await fs.writeFile(path.join(codexHome, '.codex-global-state.json'), '{}');
const env = { ...process.env, PATH: process.env.PATH || process.env.Path, CODEX_HOME: codexHome, ZOTERO_AGENT_GEMINI_DIR: gemini, CLAUDE_CONFIG_DIR: claude, DSH_HOME: dsh };
const base = createNodeSpawner({ baseEnv: env, graceMs: 100 });
const spawner = { ...base, windows: process.platform === 'win32', async spawn(command, args, opts) {
  if (/\.cmd$/i.test(command)) {
    const target = shimTarget(readFileSync(command, 'utf8')); if (!target) throw Error('Unrecognised CLI shim');
    const entry = path.join(path.dirname(command), ...target.split('\\'));
    return /\.exe$/i.test(entry) ? base.spawn(entry, args, opts) : base.spawn(process.execPath, [entry, ...args], opts);
  }
  return base.spawn(command, args, opts);
} };
const executable = process.env.ZMC_ZOTERO_BIN || 'D:\\Zotero\\zotero.exe';
const bridge = process.env.ZMC_CLAUDE_BRIDGE_DIR;
assert(bridge, 'Set ZMC_CLAUDE_BRIDGE_DIR to the installed bridge directory (SDK source only, read-only)');
await fs.mkdir(path.join(profile, 'zotero-chat'), { recursive: true });
await fs.symlink(path.resolve(bridge), path.join(profile, 'zotero-chat', 'bridges'), process.platform === 'win32' ? 'junction' : 'dir');

const sessions = [];
const saved = (backend, id) => ({ id: `xpi-${backend}`, backend, cwd, agentSessionId: id, title: 'XPI 原生项目检查', projectName: 'XPI Zotero Agent', updatedAt: Date.now() });
let proc;
const report = { passed: false, isolatedProfile: profile, isolatedLibrary: data, modelInference: false };
try {
  const cli = await findBinary(spawner, env, 'codex'); assert(cli, 'Codex CLI is required');
  const child = await spawner.spawn(cli, ['app-server'], { env, cwd });
  const rpc = new JsonRpcPeer(child);
  try {
    await rpc.request('initialize', { clientInfo: { name: 'zotero_xpi_fixture', version: '1.0' }, capabilities: { experimentalApi: true } }); rpc.notify('initialized');
    const result = await rpc.request('thread/start', { cwd, ephemeral: false, historyMode: 'legacy' });
    await rpc.request('thread/inject_items', { threadId: result.thread.id, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Synthetic XPI metadata fixture. No model call.' }] }] });
    sessions.push(saved('codex', result.thread.id));
  } finally { rpc.close(); await child.kill(); }

  const native = await prepareSession({ cwd, projectName: 'XPI Zotero Agent' }, { baseDir: gemini });
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(gemini, 'antigravity', 'conversations', `${native.agentSessionId}.db`), { readOnly: true });
  const metadata = db.prepare('select data from trajectory_metadata_blob limit 1').get().data; db.close();
  const vi = n => { const out = []; do { const b = n & 127; n >>>= 7; out.push(b | (n ? 128 : 0)); } while (n); return Buffer.from(out); };
  const field = (n, b) => Buffer.concat([vi(n * 8 + 2), vi(b.length), b]);
  const summary = new DatabaseSync(path.join(gemini, 'antigravity', 'conversation_summaries.db'));
  summary.prepare('insert into conversation_summaries (conversation_id,title,last_modified_time,workspace_uris,last_user_input_time,project_id,raw_summary) values (?,?,?,?,?,?,?)')
    .run(native.agentSessionId, 'XPI synthetic summary', new Date().toISOString(), '[]', new Date().toISOString(), native.backendProjectId, Buffer.concat([field(1, Buffer.from('XPI synthetic summary')), field(17, Buffer.from(metadata))])); summary.close();
  sessions.push(saved('antigravity', native.agentSessionId));

  const claudeID = randomUUID(), project = path.join(claude, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(project, `${claudeID}.jsonl`), JSON.stringify({ type: 'user', uuid: randomUUID(), parentUuid: null, sessionId: claudeID, cwd, isSidechain: false, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Synthetic XPI Claude fixture. No model call.' } }) + '\n');
  sessions.push(saved('claude-code', claudeID)); sessions.push(saved('deepseek-harness', randomUUID()));
  const fixtureFile = path.join(isolated, 'fixtures.json');
  await fs.writeFile(fixtureFile, JSON.stringify({ profile, data, cwd, sessions, node: process.execPath }));
  const prefs = {
    'extensions.zotero.useDataDir': true, 'extensions.zotero.dataDir': data,
    'extensions.zotero.httpServer.port': 0, 'extensions.zotero.httpServer.enabled': false,
    'extensions.autoDisableScopes': 0, 'extensions.enabledScopes': 15, 'extensions.startupScanScopes': 15,
    'extensions.zotero.sync.autoSync': false, 'extensions.zotero.firstRun2': false, 'extensions.zotero.firstRunGuidance': false,
    'extensions.zotero.lastVersion': '10.0.7', 'extensions.zotero.automaticScraperUpdates': false,
    'app.update.enabled': false,
  };
  await fs.writeFile(path.join(profile, 'user.js'), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n'));
  execFileSync(process.execPath, ['scripts/build.mjs', '--dev'], { cwd: root, stdio: 'inherit' });
  await fs.copyFile(path.join(root, 'dist/zotero-agent.xpi'), path.join(profile, 'extensions/chat@zotero-mcp.xpi'));
  const output = path.join(isolated, 'result.json');
  proc = spawn(executable, ['-no-remote', '--new-instance', '--profile', profile], { windowsHide: true, stdio: 'ignore', env: { ...env, ZMC_DEFAULT_CHAT_FOLDER: cwd,
    ZMC_TEST_SCRIPT: path.join(root, 'test/zotero/native-projects.js'), ZMC_TEST_OUT: output, ZMC_XPI_PROJECT_FIXTURES: fixtureFile, ZMC_SNAPSHOT_DIR: isolated } });
  const end = Date.now() + 120000;
  let result;
  do {
    try { result = JSON.parse(await fs.readFile(output, 'utf8')); break; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    // The Windows launcher exits 0 after handing off to the actual Zotero
    // process. Its lifetime is not the lifetime of this isolated profile.
    if (proc.exitCode !== null && proc.exitCode !== 0) throw Error(`Isolated Zotero exited without its result: ${proc.exitCode}`);
    await new Promise(r => setTimeout(r, 500));
  } while (Date.now() < end);
  assert(result?.ok, JSON.stringify(result || { error: 'Isolated Zotero timed out' }));
  for (const asset of ['codex-desktop-projects.mjs', 'antigravity-project-integration.mjs', 'dsh-project-integration.mjs']) {
    assert.deepEqual(await fs.readFile(path.join(profile, 'zotero-chat', asset)), await fs.readFile(path.join(root, 'assets', asset)));
  }
  report.passed = true; report.result = result.result;
} catch (e) { report.failure = String(e.stack || e); throw e; }
finally {
  // Only processes and queues created under this uniquely-owned test directory.
  if (proc?.exitCode === null && proc?.signalCode === null) proc.kill();
  const worker = path.join(codexHome, 'integrations/zotero-agent/sidebar-worker.json');
  try { const w = JSON.parse(await fs.readFile(worker, 'utf8')); process.kill(w.pid); } catch {}
  await fs.mkdir(path.join(root, 'test-output'), { recursive: true });
  await fs.writeFile(path.join(root, 'test-output/xpi-projects-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
