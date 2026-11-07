// Optional integration check against the installed CLI. Uses an isolated CODEX_HOME,
// synthetic persisted items and metadata RPCs; never starts model inference.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { createNodeSpawner } from '../test/node-spawner.ts';
import { findBinary } from '../src/agent/env.ts';
import { JsonRpcPeer } from '../src/agent/jsonrpc.ts';
import { shimTarget } from '../src/agent/windows.ts';
import { syncSessionMetadata } from '../src/agent/session-metadata.ts';

const home = mkdtempSync(join(tmpdir(), 'zmc-native-metadata-'));
const env = { ...process.env, PATH: process.env.PATH || process.env.Path, CODEX_HOME: home, HOME: home, USERPROFILE: home };
const base = createNodeSpawner({ baseEnv: env, graceMs: 300 });
const spawner = { ...base, windows: process.platform === 'win32',
 spawn(command, args, opts) {
  if (process.platform === 'win32' && /\.cmd$/i.test(command)) {
   const target = shimTarget(readFileSync(command, 'utf8'));
   if (!target) throw new Error('Unrecognised Codex CLI shim');
   const entry = join(dirname(command), ...target.split('\\'));
   return /\.exe$/i.test(entry) ? base.spawn(entry, args, opts) : base.spawn(process.execPath, [entry, ...args], opts);
  }
  return base.spawn(command, args, opts);
 },
};
const cli = await findBinary(spawner, env, 'codex');
if (!cli) throw new Error('Install the Codex CLI before running this optional check');
const proc = await spawner.spawn(cli, ['app-server'], { env, cwd: home });
const rpc = new JsonRpcPeer(proc);
const timer = setTimeout(() => { rpc.close('native smoke test timeout'); void proc.kill(); }, 30000);
try {
 await rpc.request('initialize', { clientInfo: { name: 'zotero_agent_test', version: '1.0.0' }, capabilities: { experimentalApi: true, requestAttestation: false } });
 rpc.notify('initialized');
 async function fixture(cwd) {
  const start = await rpc.request('thread/start', { cwd, ephemeral: false, historyMode: 'legacy' });
  const id = start.thread.id;
  await rpc.request('thread/inject_items', { threadId: id, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Synthetic metadata integration fixture' }] }] });
  return { id: `local-${id}`, title: '中文同步测试', backend: 'codex', cwd, agentSessionId: id, projectName: 'Zotero Agent', updatedAt: Date.now() };
 }
 const session = await fixture(home);
 const synced = await syncSessionMetadata(spawner, home, session);
 const again = await syncSessionMetadata(spawner, home, { ...session, title: '重命名同步成功' });
 assert.equal(synced.backendProjectId, again.backendProjectId);
 const secondDir = join(home, 'second-workspace'); mkdirSync(secondDir);
 const second = await fixture(secondDir);
 const other = await syncSessionMetadata(spawner, home, second);
 assert.equal(other.backendProjectId, synced.backendProjectId);
 const projects = await rpc.request('project/list', {});
 assert.equal(projects.data.filter(p => p.name === 'Zotero Agent').length, 1);
 const project = projects.data.find(p => p.id === synced.backendProjectId);
 assert.equal(project.roots.length, 2);
 const read = await rpc.request('thread/read', { threadId: session.agentSessionId });
 assert.equal(read.thread.name, '重命名同步成功');
 assert.equal(read.thread.projectId, synced.backendProjectId);
 const secondRead = await rpc.request('thread/read', { threadId: second.agentSessionId });
 assert.equal(secondRead.thread.projectId, synced.backendProjectId);
 const report = { passed: true, isolatedHome: home, checks: ['real installed Codex app-server', 'one project for multiple threads and working folders', 'Chinese rename persists', 'original ACP-compatible thread IDs assigned to project', 'no model inference'] };
 mkdirSync('test-output', { recursive: true });
 writeFileSync('test-output/native-sync-report.json', JSON.stringify(report, null, 2));
 console.log(JSON.stringify(report, null, 2));
} finally { clearTimeout(timer); rpc.close(); await proc.kill(); }
