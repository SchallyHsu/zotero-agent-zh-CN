// Actual installed clients, isolated homes, metadata operations only. No prompts.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prepareSession, withService } from '../assets/antigravity-project-integration.mjs';
import { registerDesktopProject } from '../assets/codex-desktop-projects.mjs';
import { syncSessionMetadata } from '../src/agent/session-metadata.ts';
import { createNodeSpawner } from '../test/node-spawner.ts';
import { createRuntime } from '../src/agent/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'zmc-project-clients-'));
const report = { passed: false, isolatedHome: root, modelInference: false, checks: [] };
let startupLog = '';
const nativeOptions = baseDir => ({ baseDir, onStartupLog: text => { startupLog = (startupLog + text).slice(-12000); } });
await mkdir('test-output', { recursive: true });
try {
  const gemini = join(root, 'gemini'), cwd = join(root, 'Zotero Agent'); await mkdir(cwd);
  const session = { cwd, projectName: 'Zotero Agent', title: '原生归类验收' };
  const fresh = await prepareSession(session, nativeOptions(gemini));
  const legacy = await prepareSession({ ...session, projectName: 'Legacy source' }, nativeOptions(gemini));
  // Stage a real native SQLite snapshot into the old CLI namespace.
  const { DatabaseSync, backup } = await import('node:sqlite');
  await mkdir(join(gemini, 'antigravity-cli', 'conversations'), { recursive: true });
  const db = new DatabaseSync(join(gemini, 'antigravity', 'conversations', `${legacy.agentSessionId}.db`), { readOnly: true });
  // Keep the native id unchanged; a separate home simulates a CLI-only store.
  const importedHome = join(root, 'old-gemini');
  await mkdir(join(importedHome, 'antigravity-cli', 'conversations'), { recursive: true });
  const sourceFile = join(importedHome, 'antigravity-cli', 'conversations', `${legacy.agentSessionId}.db`);
  await backup(db, sourceFile); db.close();
  const before = await readFile(sourceFile);
  const migrated = await prepareSession({ ...session, agentSessionId: legacy.agentSessionId }, nativeOptions(importedHome));
  // Empty native conversations have no summary until a first turn. Seed only a
  // synthetic summary for this no-inference rename check; no transcript is added.
  const encodeVarint = n => { const out = []; do { let b = n & 127; n >>>= 7; out.push(b | (n ? 128 : 0)); } while (n); return Buffer.from(out); };
  const field = (n, value) => Buffer.concat([encodeVarint(n * 8 + 2), encodeVarint(value.length), value]);
  const nativeDB = new DatabaseSync(join(importedHome, 'antigravity', 'conversations', `${migrated.agentSessionId}.db`), { readOnly: true });
  const metadataBlob = nativeDB.prepare('select data from trajectory_metadata_blob limit 1').get().data; nativeDB.close();
  const raw = Buffer.concat([field(1, Buffer.from('Synthetic fixture')), field(17, Buffer.from(metadataBlob))]);
  const summaries = new DatabaseSync(join(importedHome, 'antigravity', 'conversation_summaries.db'));
  summaries.prepare('insert or replace into conversation_summaries (conversation_id,title,last_modified_time,workspace_uris,last_user_input_time,project_id,raw_summary) values (?,?,?,?,?,?,?)').run(migrated.agentSessionId, 'Synthetic fixture', new Date().toISOString(), '[]', new Date().toISOString(), migrated.backendProjectId, raw);
  summaries.close();
  const again = await prepareSession({ ...session, agentSessionId: legacy.agentSessionId, title: '原生改名验收' }, nativeOptions(importedHome));
  assert.equal(migrated.agentSessionId, again.agentSessionId);
  assert.notEqual(migrated.agentSessionId, legacy.agentSessionId);
  assert.deepEqual(await readFile(sourceFile), before);
  await withService(importedHome, async call => {
    const metadata = await call('GetConversationMetadata', { conversationId: again.agentSessionId });
    assert.equal(metadata.metadata.projectId, migrated.backendProjectId);
    const summary = (await call('GetAllCascadeTrajectories', { excludeSubtrajectories: true })).trajectorySummaries?.[again.agentSessionId];
    assert.equal(summary.annotations?.title, '原生改名验收');
    const original = await call('GetConversationMetadata', { conversationId: legacy.agentSessionId });
    assert.equal(original.metadata.projectId, legacy.backendProjectId);
    const project = (await call('ReadProject', { id: migrated.backendProjectId })).project;
    assert.equal(project.name, 'Zotero Agent');
  });
  report.checks.push('Antigravity native project ownership and Chinese rename confirmed after service restart', 'legacy CLI SQLite snapshot imported once and continued as a deterministic native fork; original unchanged');
  const env = { ...process.env, PATH: process.env.PATH || process.env.Path, GEMINI_API_KEY: 'zotero-isolated-invalid-key' };
  const spawner = { ...createNodeSpawner({ baseEnv: env, graceMs: 100 }), windows: process.platform === 'win32' };
  const runtime = createRuntime({ spawner, nodePath: process.execPath, bridgeDir: join(root, 'bridges'), executable: () => process.env.ZMC_AGY_EXECUTABLE || join(process.env.LOCALAPPDATA || '', 'agy', 'bin', 'agy.exe') });
  const acp = await runtime.start({ backend: 'antigravity', cwd, brief: 'Synthetic brief', resumeSessionId: fresh.agentSessionId, freshNativeSession: true, antigravityStorage: { geminiDir: gemini }, auth: 'api-key' });
  assert.equal(acp.sessionId, fresh.agentSessionId); await acp.close();
  report.checks.push('real agy ACP resumes the pre-created App conversation with its original native project');

  const bridge = process.env.ZMC_CLAUDE_BRIDGE_DIR;
  if (!bridge) throw Error('Set ZMC_CLAUDE_BRIDGE_DIR to an installed claude-agent-acp bridge directory');
  const claudeConfig = join(root, 'claude'), id = randomUUID();
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  const projectDir = join(claudeConfig, 'projects', encoded); await mkdir(projectDir, { recursive: true });
  const message = { type: 'user', uuid: randomUUID(), parentUuid: null, sessionId: id, cwd, isSidechain: false, timestamp: new Date().toISOString(), message: { role: 'user', content: 'Synthetic native session fixture. No model was called.' } };
  await writeFile(join(projectDir, `${id}.jsonl`), JSON.stringify(message) + '\n');
  const claudeSpawner = { ...createNodeSpawner({ baseEnv: { ...env, CLAUDE_CONFIG_DIR: claudeConfig } }), windows: process.platform === 'win32' };
  const saved = { id: 'local-fixture', backend: 'claude-code', cwd, title: 'Claude 原生改名', projectName: 'Zotero Agent', agentSessionId: id, updatedAt: Date.now() };
  const claude = await syncSessionMetadata(claudeSpawner, resolve(bridge), saved);
  assert.equal(claude.backendProjectId, `claude-code:${resolve(cwd)}`);
  assert.equal(claude.syncPending, false);
  assert.match(await readFile(join(projectDir, `${id}.jsonl`), 'utf8'), /Claude 原生改名/);
  report.checks.push('installed official Claude Agent SDK confirms native directory project and Chinese title using isolated JSONL history');

  // The full native Codex RPC check remains test:native-codex. Exercise the
  // separate desktop catalogue against an offline isolated desktop state here.
  const codexHome = join(root, 'codex'); await mkdir(codexHome);
  await writeFile(join(codexHome, '.codex-global-state.json'), JSON.stringify({ 'local-projects': {}, 'project-order': [], untouched: true }));
  const codex = await registerDesktopProject({ backendProjectId: randomUUID(), projectName: 'Zotero Agent', roots: [cwd], sessionIds: [randomUUID()] }, { home: codexHome, worker: false, isRunning: async () => false });
  assert.equal(codex.syncPending, false);
  const state = JSON.parse(await readFile(join(codexHome, '.codex-global-state.json'), 'utf8'));
  assert.equal(Object.values(state['local-projects'])[0].name, 'Zotero Agent'); assert.equal(state.untouched, true);
  report.checks.push('Codex desktop sidebar catalogue added offline, with native project mapping and unrelated state preserved');
  report.passed = true;
} catch (e) { report.failure = String(e.stack || e); await writeFile('test-output/project-clients-startup.log', startupLog); throw e; }
finally { await writeFile('test-output/project-clients-native-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
