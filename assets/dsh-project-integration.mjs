// Zotero Agent DSH project integration (AGPL-3.0-or-later).
// The CLI queues metadata. The plugin mutates projects inside the GUI host that
// owns WorkspaceRegistry, so another process never rewrites its cached storage.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BEGIN = '# BEGIN Zotero Agent native projects';
const END = '# END Zotero Agent native projects';
const MAGIC = '// Zotero Agent DSH project integration';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pathKey = p => process.platform === 'win32' ? p.toLowerCase() : p;
export const inject = ['workspaceRegistry', 'sessionPersistence'];

async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
async function atomic(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

/** Runs only in the web/desktop host, through public DSH service methods. */
export async function syncRequests(ctx, directory) {
  const requests = await readJSON(path.join(directory, 'requests.json'), { version: 1, sessions: {} });
  if (requests.version !== 1 || !requests.sessions || typeof requests.sessions !== 'object') throw Error('Unsupported Zotero project queue');
  const ackFile = path.join(directory, 'acknowledgements.json');
  const acks = await readJSON(ackFile, { version: 1, sessions: {} });
  const pending = Object.entries(requests.sessions).filter(([id, req]) => acks.sessions[id]?.token !== req.token || acks.sessions[id]?.error);
  if (!pending.length) return;
  // DSH's listing projects headers; no transcript bodies or model requests.
  const stored = await ctx.sessionPersistence.list();
  let changed = false;
  for (const [id, req] of pending) {
    try {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !path.isAbsolute(req.cwd) || typeof req.projectName !== 'string' || !req.projectName.trim()) throw Error('Invalid project request');
      const canonical = await fs.realpath(req.cwd);
      const target = stored.find(s => s.header.id === id);
      if (!target?.header.cwd || pathKey(await fs.realpath(target.header.cwd)) !== pathKey(canonical)) throw Error('The native session is not yet visible in this DSH home');
      let workspace = await ctx.workspaceRegistry.resolveByPath(canonical);
      if (!workspace) workspace = await ctx.workspaceRegistry.create(canonical, req.projectName);
      else if (workspace.title === path.basename(canonical) && workspace.title !== req.projectName) await workspace.setTitle(req.projectName);
      // Backfill only known Zotero conversations. Other native DSH sessions in
      // the same directory may have been deliberately left ungrouped.
      const allowed = new Set([id, ...(req.relatedSessionIds || [])]);
      const matching = [];
      for (const entry of stored) {
        if (!allowed.has(entry.header.id) || !entry.header.cwd || entry.header.origin === 'subagent') continue;
        try { if (pathKey(await fs.realpath(entry.header.cwd)) === pathKey(canonical)) matching.push(entry.header); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      matching.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      for (const header of matching) await workspace.attachSession(header.id);
      acks.sessions[id] = { token: req.token, workspaceId: workspace.id, title: workspace.title, completedAt: new Date().toISOString() };
      changed = true;
    } catch (e) {
      const error = String(e.message || e);
      if (acks.sessions[id]?.error !== error || acks.sessions[id]?.token !== req.token) {
        acks.sessions[id] = { token: req.token, error }; changed = true;
      }
    }
  }
  if (changed) await atomic(ackFile, acks);
}

/** A local DSH companion plugin. No agent tools or prompts are registered. */
export function apply(ctx, config) {
  if (!config || !path.isAbsolute(config.directory)) throw Error('Zotero project integration requires an absolute state directory');
  let running = false, stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try { await syncRequests(ctx, config.directory); }
    catch (e) { ctx.logger?.warn(`Zotero project sync: ${String(e.message || e)}`); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), 1000);
  ctx.effect(() => () => { stopped = true; clearInterval(timer); }, 'zotero.projectSync');
  void tick();
}

async function withLock(directory, run) {
  const lock = path.join(directory, 'queue.lock');
  let handle;
  for (let i = 0; i < 80; i++) {
    try { handle = await fs.open(lock, 'wx', 0o600); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - (await fs.stat(lock)).mtimeMs > 120000) await fs.unlink(lock); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      await pause(50);
    }
  }
  if (!handle) throw Error('The DSH project queue is busy; try again');
  try { return await run(); }
  finally { await handle.close(); await fs.unlink(lock).catch(() => {}); }
}

/** Installs one reversible, managed home patch; preserves other profile settings. */
export async function installIntegration(home) {
  const directory = path.join(home, 'integrations', 'zotero-agent');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await withLock(directory, async () => {
    const module = path.join(directory, 'projects.mjs');
    const source = await fs.readFile(fileURLToPath(import.meta.url), 'utf8');
    let existing = '';
    try { existing = await fs.readFile(module, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (existing && !existing.startsWith(MAGIC)) throw Error('DSH companion module path is already used by another file');
    if (source !== existing) await atomic(module, source);
    const patchFile = path.join(home, 'cordis.patch.yml');
    let raw = '';
    try { raw = await fs.readFile(patchFile, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const block = `${BEGIN}\n- insert:\n    - id: zotero-agent-native-projects\n      name: ${JSON.stringify(pathToFileURL(module).href)}\n      disabled: !!js "!['web', 'desktop'].includes(ctx.get('profileContext')?.name)"\n      config:\n        directory: ${JSON.stringify(directory)}\n${END}`;
    let base = raw;
    const start = base.indexOf(BEGIN), end = base.indexOf(END);
    if (start >= 0) {
      if (end < start || base.indexOf(BEGIN, start + BEGIN.length) >= 0) throw Error('The managed DSH integration block is ambiguous');
      base = base.slice(0, start) + base.slice(end + END.length);
    } else if (base.includes('zotero-agent-native-projects')) throw Error('An unmanaged DSH integration entry already exists');
    const body = base.replace(/^\s*#.*$/gm, '').trim();
    if (body === '[]') base = base.replace(/^\s*\[\]\s*$/m, '');
    else if (body && !body.startsWith('- ')) throw Error('DSH home patch must be a YAML patch array; existing file was left unchanged');
    const next = `${base.trimEnd()}${base.trim() ? '\n\n' : ''}${block}\n`;
    if (next === raw) return;
    if (raw) try { await fs.writeFile(`${patchFile}.zotero-agent.bak`, raw, { flag: 'wx', mode: 0o600 }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    // Do not overwrite a concurrently edited home patch.
    let latest = ''; try { latest = await fs.readFile(patchFile, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (latest !== raw) throw Error('DSH configuration changed during installation; retry');
    await atomic(patchFile, next);
  });
  return directory;
}

export async function enqueueProject(session, options = {}) {
  const home = path.resolve(options.home || process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh'));
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(session.agentSessionId) || !path.isAbsolute(session.cwd)) throw Error('Invalid native DSH session identity or working directory');
  const projectName = (session.projectName || 'Zotero Agent').trim().slice(0, 120) || 'Zotero Agent';
  const relatedSessionIds = [...new Set((session.relatedSessionIds || []).filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)))].sort();
  const directory = await installIntegration(home);
  const token = createHash('sha256').update(JSON.stringify([session.agentSessionId, session.cwd, projectName, relatedSessionIds])).digest('hex');
  await withLock(directory, async () => {
    const file = path.join(directory, 'requests.json');
    const requests = await readJSON(file, { version: 1, sessions: {} });
    if (requests.version !== 1 || !requests.sessions) throw Error('Unsupported DSH project queue');
    if (requests.sessions[session.agentSessionId]?.token === token) return;
    requests.sessions[session.agentSessionId] = { cwd: session.cwd, projectName, relatedSessionIds, token };
    await atomic(file, requests);
  });
  const deadline = Date.now() + (options.waitMs ?? 3000);
  do {
    const acks = await readJSON(path.join(directory, 'acknowledgements.json'), { sessions: {} });
    const ack = acks.sessions[session.agentSessionId];
    if (ack?.token === token && ack.workspaceId && !ack.error) return { backendProjectId: ack.workspaceId, syncPending: false };
    if (Date.now() >= deadline) return { syncPending: true, ...(ack?.token === token && ack.error ? { syncReason: ack.error } : {}) };
    await pause(100);
  } while (true);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const request = process.argv[2] === '--request-file' ? fs.readFile(process.argv[3], 'utf8') : Promise.resolve(process.argv[2] || '{}');
  request.then(JSON.parse).then(session => enqueueProject(session)).then(result => console.log(JSON.stringify(result)))
    .catch(e => { console.error(String(e.message || e)); process.exitCode = 1; });
}
