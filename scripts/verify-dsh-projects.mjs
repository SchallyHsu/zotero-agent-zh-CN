// Actual DSH GUI-host registry test. Everything lives in a fresh DSH_HOME;
// no model prompts, user credentials, or real DSH projects are touched.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { createNodeSpawner } from '../test/node-spawner.ts';
import { createRuntime } from '../src/agent/runtime.ts';
import { findBinary } from '../src/agent/env.ts';
import { shimTarget } from '../src/agent/windows.ts';
import { enqueueProject } from '../assets/dsh-project-integration.mjs';

const home = mkdtempSync(join(tmpdir(), 'zmc-dsh-native-projects-'));
const env = { ...process.env, PATH: process.env.PATH || process.env.Path, DSH_HOME: home, AGENTS_HOME: join(home, 'agents'), HOME: home, USERPROFILE: home };
for (const key of Object.keys(env)) if (/^(DEEPSEEK|OPENAI|ANTHROPIC|GEMINI|GOOGLE|CODEX).*KEY$/.test(key)) delete env[key];
const entry = process.env.ZMC_DSH_ENTRY ? resolve(process.env.ZMC_DSH_ENTRY) : undefined;
const selected = entry ? process.execPath : process.env.ZMC_DSH_EXECUTABLE;
const base = createNodeSpawner({ baseEnv: env, graceMs: 1000 });
const spawner = { ...base, windows: process.platform === 'win32', spawn(command, args, opts) {
 if (entry && command === process.execPath) return base.spawn(command, [entry, ...args], opts);
 if (process.platform === 'win32' && /\.cmd$/i.test(command)) {
  const target = shimTarget(readFileSync(command, 'utf8')); if (!target) throw Error('Unrecognised dsh shim');
  return base.spawn(process.execPath, [join(dirname(command), ...target.split('\\')), ...args], opts);
 }
 return base.spawn(command, args, opts);
} };
const cli = selected || await findBinary(spawner, env, 'dsh');
if (!cli) throw Error('Set ZMC_DSH_EXECUTABLE or install dsh before running this optional check');
const runtime = createRuntime({ spawner, bridgeDir: join(home, 'unused'), executable: () => cli, initTimeoutMs: 25000 });
const projects = join(home, 'storages/workspace.json');
const readProjects = () => JSON.parse(readFileSync(projects, 'utf8'));
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate, label, ms = 25000) {
 const deadline = Date.now() + ms;
 while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await pause(150); }
 throw Error(`Timed out: ${label}`);
}
const active = new Set();
async function web() {
 const proc = await spawner.spawn(cli, ['--profile', 'web', '--no-open', '--port', '0'], { env, cwd: home });
 active.add(proc);
 const result = { proc, url: '', stderr: '', stdout: '', exited: null };
 proc.onStdoutLine(line => { result.stdout += line + '\n'; const match = line.match(/https?:\/\/127\.0\.0\.1:\d+[^\s]*/); if (match) result.url = match[0]; });
 proc.onStderr(chunk => { result.stderr += chunk; });
 void proc.exited.then(code => { result.exited = code; });
 await until(() => {
  if (result.exited !== null) throw Error(`DSH web exited: ${result.stderr.slice(-5000)}\n${result.stdout.slice(-1000)}`);
  return result.url && existsSync(projects);
 }, 'native web host ready');
 return result;
}
async function stop(host) { await host.proc.kill(); active.delete(host.proc); }
async function fixture(cwd) {
 mkdirSync(cwd, { recursive: true });
 const s = await runtime.start({ backend: 'deepseek-harness', cwd, brief: 'Synthetic project metadata fixture.' });
 const id = s.sessionId; await s.close();
 return { agentSessionId: id, cwd, projectName: 'Zotero Agent' };
}
try {
 // Bootstrap one ordinary project first. New ACP sessions created later must
 // stay ungrouped without the fix, matching an already initialized real GUI.
 const unrelated = await fixture(join(home, 'Existing user project'));
 let host = await web();
 const original = readProjects();
 const oldId = Object.keys(original.tables.workspaces).find(id => original.tables.workspaces[id].sessionIds.includes(unrelated.agentSessionId));
 assert(oldId);
 const oldRecord = original.tables.workspaces[oldId];
 await stop(host);
 const first = await fixture(join(home, 'Zotero Agent'));
 const second = await fixture(first.cwd);
 const unrequested = await fixture(first.cwd);
 second.relatedSessionIds = [first.agentSessionId];
 assert(!Object.values(readProjects().tables.workspaces).some(p => p.sessionIds.includes(first.agentSessionId)), 'must reproduce missing native membership before installing companion');
 const patch = join(home, 'cordis.patch.yml');
 const userPatch = '# Preserve this user setting\n- id: session-title-llm\n  disabled: true\n';
 writeFileSync(patch, userPatch);
 assert.deepEqual(await enqueueProject(second, { home, waitMs: 0 }), { syncPending: true });
 assert.equal(readFileSync(`${patch}.zotero-agent.bak`, 'utf8'), userPatch);
 host = await web();
 const registered = await until(async () => {
  const result = await enqueueProject(second, { home, waitMs: 0 });
  if (!result.backendProjectId && existsSync(join(home, 'integrations/zotero-agent/acknowledgements.json'))) {
   const ack = JSON.parse(readFileSync(join(home, 'integrations/zotero-agent/acknowledgements.json'), 'utf8')).sessions[second.agentSessionId];
   if (ack?.error) throw Error(`Companion: ${ack.error}`);
  }
  return result.backendProjectId ? result : false;
 }, 'legacy sessions registered in native project');
 let rows = readProjects().tables.workspaces;
 assert.equal(rows[registered.backendProjectId].title, 'Zotero Agent');
 assert(rows[registered.backendProjectId].sessionIds.includes(first.agentSessionId));
 assert(rows[registered.backendProjectId].sessionIds.includes(second.agentSessionId));
 assert(!rows[registered.backendProjectId].sessionIds.includes(unrequested.agentSessionId));
 assert.deepEqual(rows[oldId], oldRecord, 'unrelated native project must remain unchanged');
 // Now create a new ACP session while the GUI host is already running.
 const third = await fixture(first.cwd);
 const inputFile = join(home, 'project-request.json');
 writeFileSync(inputFile, JSON.stringify(third));
 const helperRun = await base.run(process.execPath, [resolve('assets/dsh-project-integration.mjs'), '--request-file', inputFile], { env, timeoutMs: 15000 });
 assert.equal(helperRun.code, 0, helperRun.stderr);
 const live = JSON.parse(helperRun.stdout.trim());
 assert.equal(live.backendProjectId, registered.backendProjectId);
 rows = readProjects().tables.workspaces;
 assert(rows[registered.backendProjectId].sessionIds.includes(third.agentSessionId));
 assert.equal(Object.values(rows).filter(p => p.path.toLowerCase() === first.cwd.toLowerCase()).length, 1);
 const before = readFileSync(projects, 'utf8');
 assert.equal((await enqueueProject(third, { home, waitMs: 0 })).backendProjectId, registered.backendProjectId);
 await pause(1100); assert.equal(readFileSync(projects, 'utf8'), before, 'repeated sync must not rewrite or duplicate native records');
 let browserProjectVisible = false;
 if (process.env.BROWSER_EXECUTABLE) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE });
  try {
   const page = await browser.newPage({ viewport: { width: 1200, height: 860 } });
   const errors = []; page.on('pageerror', e => errors.push(e.message));
   await page.goto(host.url);
   try { await page.getByText('Zotero Agent', { exact: true }).first().waitFor({ state: 'visible', timeout: 20000 }); }
   catch (e) {
    mkdirSync('test-output', { recursive: true });
    await page.screenshot({ path: 'test-output/dsh-native-project-failure.png' });
    writeFileSync('test-output/dsh-native-project-failure.json', JSON.stringify({ url: new URL(host.url).origin, text: await page.locator('body').innerText(), errors }, null, 2));
    throw e;
   }
   mkdirSync('test-output', { recursive: true });
   await page.screenshot({ path: 'test-output/dsh-native-project-visible.png' });
   browserProjectVisible = true;
  } finally { await browser.close(); }
 }
 await stop(host);
 host = await web();
 rows = readProjects().tables.workspaces;
 assert(rows[registered.backendProjectId].sessionIds.includes(third.agentSessionId));
 await stop(host);
 const report = { passed: true, isolatedHome: home, browserProjectVisible, checks: ['reproduced ACP sessions missing from an initialized native registry', 'legacy ACP sessions backfilled', 'native project created once', 'new sessions attached through the real metadata helper while GUI host is running', 'unrelated native project preserved', 'unrequested conversations in the same directory remain ungrouped', 'repeated sync is idempotent', 'native membership survives host restart'], modelInference: false };
 mkdirSync('test-output', { recursive: true });
 writeFileSync('test-output/dsh-projects-native-report.json', JSON.stringify(report, null, 2));
 console.log(JSON.stringify(report, null, 2));
} finally { await Promise.all([...active].map(proc => proc.kill())); }
