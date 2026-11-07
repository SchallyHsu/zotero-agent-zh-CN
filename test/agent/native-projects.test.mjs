import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerDesktopProject, flushQueue, mergeDesktopState, isDesktopExecutable } from '../../assets/codex-desktop-projects.mjs';
import { prepareSession, withService } from '../../assets/antigravity-project-integration.mjs';
import { createServer } from 'node:http';

const request = cwd => ({ backendProjectId: 'native-project', projectName: 'Zotero Agent', roots: [cwd], sessionIds: ['zotero-thread'] });
test('Codex desktop detection excludes the CLI/ACP processes that remain running inside Zotero', () => {
  assert(isDesktopExecutable('C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.1103.4239.0_x64__id\\app\\ChatGPT.exe', 'win32'));
  assert(isDesktopExecutable('C:\\Users\\test\\AppData\\Local\\Programs\\Codex\\Codex.exe', 'win32'));
  assert(!isDesktopExecutable('C:\\Users\\test\\AppData\\Local\\OpenAI\\Codex\\bin\\version\\codex.exe', 'win32'));
  assert(!isDesktopExecutable('C:\\Users\\test\\node_modules\\@openai\\codex\\vendor\\win\\codex\\codex.exe', 'win32'));
  assert(isDesktopExecutable('/Applications/Codex.app/Contents/MacOS/Codex', 'darwin'));
  assert(!isDesktopExecutable('/usr/local/bin/codex', 'linux'));
});
test('Codex waits for desktop exit, preserves unrelated state and backs up before registering its sidebar', async () => {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'zmc-codex-sidebar-')));
  const file = path.join(home, '.codex-global-state.json');
  const state = { setting: { untouched: true }, 'local-projects': { other: { id: 'other', name: 'My project', rootPaths: ['/original'] } }, 'project-order': ['other'], 'thread-project-assignments': { unrelated: 'other' }, 'projectless-thread-ids': ['unrelated', 'zotero-thread'] };
  const original = JSON.stringify(state);
  await fs.writeFile(file, original);
  assert.equal((await registerDesktopProject(request(home), { home, worker: false, isRunning: async () => true })).syncPending, true);
  assert.equal(await fs.readFile(file, 'utf8'), original, 'a running desktop owns its in-memory configuration');
  assert.equal(await flushQueue(home, { isRunning: async () => false }), true);
  const result = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(result.setting, state.setting);
  assert.deepEqual(result['local-projects'].other, state['local-projects'].other);
  assert.deepEqual(result['project-order'], ['other', 'native-project']);
  assert.equal(result['thread-project-assignments'].unrelated, 'other');
  assert.deepEqual(result['thread-project-assignments']['zotero-thread'], { projectKind: 'local', projectId: 'native-project' });
  assert.deepEqual(result['projectless-thread-ids'], ['unrelated']);
  assert.equal(await fs.readFile(`${file}.zotero-agent.bak`, 'utf8'), original);
  assert.deepEqual(await registerDesktopProject(request(home), { home, worker: false, isRunning: async () => true }), { syncPending: false });
  const before = await fs.readFile(file, 'utf8');
  await flushQueue(home, { isRunning: async () => false });
  assert.equal(await fs.readFile(file, 'utf8'), before, 'repeated registration does not rewrite the desktop state');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(home, 'integrations/zotero-agent/sidebar-requests.json'), 'utf8')).projects, {});
  delete result['local-projects']['native-project'];
  await fs.writeFile(file, JSON.stringify(result));
  await flushQueue(home, { isRunning: async () => false });
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8'))['local-projects']['native-project'], undefined, 'completed queue entries never resurrect a later-deleted project');
});
test('Codex retains a native project alias and refuses incompatible state instead of overwriting it', () => {
  const home = path.resolve('fixture');
  const state = { 'local-projects': { alias: { id: 'alias', name: 'User label', rootPaths: [home], createdAt: 1 } }, 'app-server-project-id-by-legacy-project-id-by-host': { [`local:${home}`]: { alias: 'native-project' } } };
  const merged = mergeDesktopState(state, request(home), home);
  assert.equal(merged['local-projects'].alias.name, 'User label');
  assert.equal(Object.keys(merged['local-projects']).length, 1);
  assert.deepEqual(merged['thread-project-assignments']['zotero-thread'], { projectKind: 'local', projectId: 'alias' });
  assert.throws(() => mergeDesktopState({ 'local-projects': [] }, request(home), home), /Unsupported/);
});
test('Codex rechecks for a desktop startup before writing', async () => {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'zmc-codex-startup-')));
  const file = path.join(home, '.codex-global-state.json'); await fs.writeFile(file, '{}');
  let count = 0;
  const result = await registerDesktopProject(request(home), { home, worker: false, isRunning: async () => ++count >= 3 });
  assert.equal(result.syncPending, true);
  assert.equal(await fs.readFile(file, 'utf8'), '{}');
});
test('Antigravity reuses a named native project and forks a legacy conversation once, preserving the source', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zmc-agy-metadata-'));
  const cwd = await fs.realpath(baseDir);
  const old = 'legacy-conversation';
  await fs.mkdir(path.join(baseDir, 'antigravity', 'conversations'), { recursive: true });
  await fs.writeFile(path.join(baseDir, 'antigravity', 'conversations', `${old}.db`), 'never rewritten');
  const uri = pathToFileURL(cwd).href;
  const projects = new Map([['user-project', { id: 'user-project', name: 'Zotero Agent', settings: { sandboxMode: true }, projectResources: { resources: [{ folderUri: uri }] } }]]);
  const sessions = new Map([[old, { metadata: { projectId: 'default-cli-project', workspaceUris: [uri] } }]]);
  const calls = [];
  const call = async (method, params) => {
    calls.push({ method, params });
    if (method === 'ListProjects') return { projectIds: [...projects.keys()] };
    if (method === 'ReadProject') return { project: projects.get(params.id) };
    if (method === 'LoadTrajectory') return {};
    if (method === 'GetConversationMetadata') { if (!sessions.has(params.conversationId)) throw Error('not found'); return sessions.get(params.conversationId); }
    if (method === 'StartCascade') { sessions.set(params.cascadeId, { metadata: { projectId: params.projectEnvConfig.projectId, workspaceUris: [uri] } }); return { cascadeId: params.cascadeId }; }
    if (method === 'UpdateConversationAnnotations') return {};
    if (method === 'GetAllCascadeTrajectories') return {};
    throw Error(`unexpected native mutation ${method}`);
  };
  const input = { agentSessionId: old, cwd, projectName: 'Zotero Agent', title: 'Chinese title' };
  const first = await prepareSession(input, { baseDir, call });
  await fs.writeFile(path.join(baseDir, 'antigravity', 'conversations', `${first.agentSessionId}.db`), 'native fork');
  const second = await prepareSession(input, { baseDir, call });
  assert.equal(second.agentSessionId, first.agentSessionId);
  assert.notEqual(first.agentSessionId, old);
  assert.equal(first.backendProjectId, 'user-project');
  assert.equal(calls.filter(c => c.method === 'StartCascade').length, 1);
  assert.equal(calls.find(c => c.method === 'StartCascade').params.baseTrajectoryIdentifier.cascadeId, old);
  assert.equal(await fs.readFile(path.join(baseDir, 'antigravity', 'conversations', `${old}.db`), 'utf8'), 'never rewritten');
  assert.equal(sessions.get(old).metadata.projectId, 'default-cli-project');
});

test('a confirmed Antigravity resume uses existing App storage without a native service or title mutation', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zmc-agy-fast-resume-'));
  const cwd = await fs.realpath(baseDir), id = 'existing-app-session', projectId = 'confirmed-project';
  const databases = path.join(baseDir, 'antigravity', 'conversations'), projects = path.join(baseDir, 'config', 'projects');
  await fs.mkdir(databases, { recursive: true }); await fs.mkdir(projects, { recursive: true });
  await fs.writeFile(path.join(databases, `${id}.db`), 'existing native data');
  const project = { id: projectId, projectResources: { resources: [{ folderUri: pathToFileURL(cwd).href }] } };
  await fs.writeFile(path.join(projects, `${projectId}.json`), JSON.stringify(project));
  const request = { cwd, agentSessionId: id, confirmedProjectId: projectId, operation: 'resume', title: 'already synced' };
  const options = { baseDir, call: async () => { throw Error('native verification reached'); } };
  const result = await prepareSession(request, options);
  assert.equal(result.metadataReused, true);
  assert.equal(result.agentSessionId, id);
  assert.equal(result.geminiDir, baseDir);
  assert.equal(await fs.readFile(path.join(databases, `${id}.db`), 'utf8'), 'existing native data');
  // A cached local record never moves a missing/legacy session into the App
  // namespace, and a moved project directory still requires native validation.
  await fs.unlink(path.join(databases, `${id}.db`));
  await assert.rejects(prepareSession(request, options), /native verification reached/);
  await fs.writeFile(path.join(databases, `${id}.db`), 'existing native data');
  project.projectResources.resources = [{ folderUri: pathToFileURL(path.dirname(cwd)).href }];
  await fs.writeFile(path.join(projects, `${projectId}.json`), JSON.stringify(project));
  await assert.rejects(prepareSession(request, options), /native verification reached/);
});

test('an obsolete live daemon has a bounded probe and cannot block a healthy Antigravity service', { timeout: 5000 }, async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zmc-agy-probe-'));
  const daemon = path.join(baseDir, 'antigravity', 'daemon'); await fs.mkdir(daemon, { recursive: true });
  let stalledCalls = 0, healthyCalls = 0;
  const stalled = createServer(() => { stalledCalls++; });
  const healthy = createServer((_req, response) => { healthyCalls++; response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"projectIds":[]}'); });
  for (const server of [stalled, healthy]) await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const old = path.join(daemon, 'hub_1.json'), recent = path.join(daemon, 'hub_2.json');
    await fs.writeFile(old, JSON.stringify({ pid: process.pid, httpPort: healthy.address().port, csrfToken: 'fixture' }));
    await fs.writeFile(recent, JSON.stringify({ pid: process.pid, httpPort: stalled.address().port, csrfToken: 'fixture' }));
    await fs.utimes(recent, new Date(Date.now() + 1000), new Date(Date.now() + 1000));
    const start = performance.now();
    assert.equal(await withService(baseDir, async () => 'healthy service', { discoveryTimeoutMs: 50 }), 'healthy service');
    assert.equal(stalledCalls, 1); assert.equal(healthyCalls, 1);
    assert(performance.now() - start < 1500, 'discovery must not wait a normal 15 second operation timeout');
  } finally {
    for (const server of [stalled, healthy]) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  }
});
