// Zotero Agent native Antigravity integration (AGPL-3.0-or-later).
// Uses the installed App's local metadata service. It never sends a model prompt.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pause = ms => new Promise(r => setTimeout(r, ms));
const key = p => process.platform === 'win32' ? p.toLowerCase() : p;
const uuid = value => {
  const h = createHash('sha256').update(value).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
async function exists(file) { try { await fs.access(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }

function client(port, token, timeoutMs = 15000) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || typeof token !== 'string' || !token) throw Error('Invalid Antigravity local service identity');
  return async (method, data) => {
    const r = await fetch(`http://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-codeium-csrf-token': token },
      body: JSON.stringify(data), signal: AbortSignal.timeout(timeoutMs),
    });
    const result = await r.json();
    if (!r.ok) throw Error(`Antigravity ${method}: ${String(result.message || result.code || r.status).slice(0, 400)}`);
    return result;
  };
}

/** Prefer the running App so its caches and project update stream stay current. */
export async function withService(baseDir, run, options = {}) {
  if (options.call) return run(options.call);
  const daemon = path.join(baseDir, 'antigravity', 'daemon');
  const files = (await fs.readdir(daemon).catch(e => e.code === 'ENOENT' ? [] : Promise.reject(e))).filter(file => /^hub_\d+\.json$/.test(file));
  const records = (await Promise.all(files.map(async file => {
    try { const p = path.join(daemon, file); return { d: JSON.parse(await fs.readFile(p, 'utf8')), modified: (await fs.stat(p)).mtimeMs }; }
    catch { return undefined; }
  }))).filter(Boolean).sort((a, b) => b.modified - a.modified);
  for (const { d } of records) {
    let call;
    try {
      process.kill(d.pid, 0);
      await client(d.httpPort, d.csrfToken, options.discoveryTimeoutMs ?? 1000)('ListProjects', { backend: 1 });
      call = client(d.httpPort, d.csrfToken);
    } catch { continue; }
    return run(call);
  }
  const candidates = [options.serverExecutable, process.env.ZOTERO_AGENT_ANTIGRAVITY_SERVER,
    process.platform === 'win32' && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe'),
    '/Applications/Antigravity.app/Contents/Resources/bin/language_server',
    '/opt/Antigravity/resources/bin/language_server', '/opt/antigravity/resources/bin/language_server',
  ].filter(Boolean);
  let executable;
  for (const file of candidates) if (await exists(file)) { executable = file; break; }
  if (!executable) throw Error('Install and open Antigravity App to enable native projects; agy ACP alone does not expose project creation.');
  const token = randomUUID();
  const proc = spawn(executable, ['--standalone', '--headless', '--override_ide_name', 'antigravity', '--subclient_type', 'hub',
    '--gemini_dir', baseDir, '--app_data_dir', 'antigravity', '--http_server_port', '0', '--csrf_token', token, '--disable_telemetry'],
  { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  proc.stderr.on('data', data => options.onStartupLog?.(String(data).replaceAll(token, '[local-token]')));
  let failure; proc.on('error', e => { failure = e; }); proc.stdin.end();
  const closed = new Promise(r => proc.once('close', r));
  let call, ownDaemon;
  try {
    let ready = false, lastError;
    for (let i = 0; i < 200; i++) {
      if (failure) throw failure;
      if (proc.exitCode !== null) throw Error('Antigravity metadata service exited before startup');
      // Let the native server bind its own ephemeral ports. Reserving and then
      // releasing a port leaves a race with its other HTTP/gRPC listeners.
      if (!call) {
        for (const name of await fs.readdir(daemon).catch(() => [])) {
          if (!/^hub_\d+\.json$/.test(name)) continue;
          try {
            const file = path.join(daemon, name), d = JSON.parse(await fs.readFile(file, 'utf8'));
            if (d.pid === proc.pid && d.csrfToken === token) { call = client(d.httpPort, token); ownDaemon = file; break; }
          } catch {}
        }
      }
      if (call) try { await call('ListProjects', { backend: 1 }); ready = true; break; } catch (e) { lastError = e; }
      await pause(100);
    }
    if (!ready) throw Error(`Antigravity metadata service did not become ready: ${lastError?.message || 'startup timed out'}`);
    return await run(call);
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill();
    let exitTimer;
    try { await Promise.race([closed, new Promise(r => { exitTimer = setTimeout(r, 2000); })]); }
    finally { clearTimeout(exitTimer); }
    if (proc.exitCode === null && proc.signalCode === null) { proc.kill('SIGKILL'); await closed; }
    if (ownDaemon) try {
      const d = JSON.parse(await fs.readFile(ownDaemon, 'utf8'));
      if (d.pid === proc.pid && d.csrfToken === token) await fs.unlink(ownDaemon);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

async function ensureProject(call, cwd, name) {
  let id = uuid(`zotero-agent-project:${name}`);
  const listed = await call('ListProjects', { backend: 1 });
  let project;
  for (const candidate of listed.projectIds || []) {
    const found = (await call('ReadProject', { id: candidate })).project;
    if (found?.id === id || found?.name === name) { project = found; id = found.id; break; }
  }
  const uri = pathToFileURL(cwd).href;
  if (!project) {
    await call('CreateProject', { project: { id, name, projectResources: { resources: [{ folderUri: uri }] } }, backend: 1 });
  } else {
    const resources = project.projectResources?.resources || [];
    if (!resources.some(r => r.folderUri && key(r.folderUri.replace(/\/$/, '')) === key(uri.replace(/\/$/, '')))) {
      await call('UpdateProject', { project: { ...project, projectResources: { ...project.projectResources, resources: [...resources, { folderUri: uri }] } } });
    }
  }
  const confirmed = (await call('ReadProject', { id })).project;
  if (confirmed?.id !== id) throw Error('Antigravity did not confirm the native project');
  return confirmed;
}

/** One-time snapshot import; never rewrites either an original or an existing App conversation. */
export async function importLegacy(baseDir, id) {
  if (!validId(id)) throw Error('Invalid Antigravity session id');
  const target = path.join(baseDir, 'antigravity', 'conversations', `${id}.db`);
  if (await exists(target)) return;
  const source = path.join(baseDir, 'antigravity-cli', 'conversations', `${id}.db`);
  if (!await exists(source)) throw Error('Antigravity conversation was not found in the CLI or App store');
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const { DatabaseSync, backup } = await import('node:sqlite');
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    // SQLite backup includes committed WAL content; copying a live .db does not.
    await backup(db, temporary);
    await fs.link(temporary, target); // exclusive: a concurrently-created target wins
  } catch (e) { if (e.code !== 'EEXIST') throw e; }
  finally { db.close(); await fs.unlink(temporary).catch(() => {}); }
  const brain = path.join(baseDir, 'antigravity-cli', 'brain', id);
  const destination = path.join(baseDir, 'antigravity', 'brain', id);
  if (await exists(brain) && !await exists(destination)) await fs.cp(brain, destination, { recursive: true, force: false, errorOnExist: true });
}

export async function prepareSession(session, options = {}) {
  if (!path.isAbsolute(session.cwd)) throw Error('Antigravity requires an absolute working directory');
  const cwd = await fs.realpath(session.cwd);
  const name = (session.projectName || 'Zotero Agent').trim().slice(0, 120) || 'Zotero Agent';
  const baseDir = path.resolve(options.baseDir || process.env.ZOTERO_AGENT_GEMINI_DIR || path.join(os.homedir(), '.gemini'));
  // A previously confirmed App conversation needs only its local storage when
  // resuming. Do not start another language server or rescan histories before
  // sending the prompt. Full title/ownership synchronization still runs later.
  if (session.operation === 'resume' && validId(session.agentSessionId) && validId(session.confirmedProjectId)) {
    try {
      const database = path.join(baseDir, 'antigravity', 'conversations', `${session.agentSessionId}.db`);
      const project = JSON.parse(await fs.readFile(path.join(baseDir, 'config', 'projects', `${session.confirmedProjectId}.json`), 'utf8'));
      const resources = project.projectResources?.resources || [];
      const matches = resources.some(r => { try { return key(path.resolve(fileURLToPath(r.folderUri))) === key(cwd); } catch { return false; } });
      if ((await fs.stat(database)).isFile() && project.id === session.confirmedProjectId && matches) {
        return { agentSessionId: session.agentSessionId, backendProjectId: project.id, geminiDir: baseDir, syncPending: false, metadataReused: true };
      }
    } catch { /* Missing/moved storage falls back to the native verification and migration path. */ }
  }
  return withService(baseDir, async call => {
    const project = await ensureProject(call, cwd, name);
    let id = session.agentSessionId;
    if (id) {
      await importLegacy(baseDir, id);
      await call('LoadTrajectory', { cascadeId: id });
      const source = await call('GetConversationMetadata', { conversationId: id });
      const uris = source.metadata?.workspaceUris || source.metadata?.workspaces?.map(w => w.workspaceFolderAbsoluteUri) || [];
      if (!uris.some(uri => { try { return key(path.resolve(fileURLToPath(uri))) === key(cwd); } catch { return false; } })) throw Error('Antigravity conversation directory does not match this Zotero history');
      if (source.metadata?.projectId !== project.id) {
        // The native API implements moving conversations as a fork. Keep the
        // source untouched and use a deterministic id so retries cannot duplicate it.
        const next = uuid(`zotero-agent-fork:${id}:${project.id}`);
        const existing = await call('GetConversationMetadata', { conversationId: next }).catch(e => { if (/not[_ ]found/i.test(e.message)) return undefined; throw e; });
        if (!existing) await call('StartCascade', { source: 1, cascadeId: next, baseTrajectoryIdentifier: { cascadeId: id }, projectEnvConfig: { projectId: project.id, defaultProjectEnvironment: {} } });
        id = next;
      }
    } else {
      const result = await call('StartCascade', { source: 1, projectEnvConfig: { projectId: project.id, defaultProjectEnvironment: {} } });
      id = result.cascadeId;
    }
    if (!validId(id)) throw Error('Antigravity returned no native conversation id');
    if (session.title) await call('UpdateConversationAnnotations', { cascadeIds: [id], annotations: { title: session.title }, mergeAnnotations: true });
    const confirmed = await call('GetConversationMetadata', { conversationId: id });
    if (confirmed.metadata?.projectId !== project.id) throw Error('Antigravity did not confirm native conversation ownership');
    const summary = session.title ? (await call('GetAllCascadeTrajectories', { excludeSubtrajectories: true })).trajectorySummaries?.[id] : undefined;
    if (summary && summary.annotations?.title !== session.title) throw Error('Antigravity did not confirm the native conversation title');
    const pending = !!session.title && !summary;
    return { agentSessionId: id, backendProjectId: project.id, syncPending: pending, geminiDir: baseDir,
      ...(pending ? { syncReason: 'Antigravity 原生项目已确认；会话名称将在首条回复形成原生摘要后同步。' } : {}) };
  }, options);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  fs.readFile(process.argv[3], 'utf8').then(JSON.parse).then(s => prepareSession(s))
    .then(result => console.log(JSON.stringify(result))).catch(e => { console.error(String(e.message || e)); process.exitCode = 1; });
}
