// Zotero Agent Codex desktop project registration (AGPL-3.0-or-later).
// App-server owns native projects/threads; the desktop also keeps a local sidebar
// catalogue. Queue that catalogue update until the desktop has fully exited.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const exec = promisify(execFile);
const pause = ms => new Promise(r => setTimeout(r, ms));
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const readJSON = async (file, missing) => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return missing; throw e; } };
const pathKey = p => process.platform === 'win32' ? p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : p;
const knownCli = file => /\/(?:node_modules|vendor)\//i.test(file.replace(/\\/g, '/')) || /\/OpenAI\/Codex\/bin\//i.test(file.replace(/\\/g, '/')) || /^\/(?:usr\/local|usr|home\/[^/]+\/\.local)\/bin\/codex$/.test(file);
const powershellExe = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
async function atomic(file, data) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(tmp, data, { mode: 0o600 }); await fs.rename(tmp, file); }
  finally { await fs.unlink(tmp).catch(() => {}); }
}
async function lock(directory, name, fn) {
  const file = path.join(directory, name);
  let handle;
  for (let i = 0; i < 60; i++) {
    try { handle = await fs.open(file, 'wx', 0o600); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const stat = await fs.stat(file).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > 120000) await fs.unlink(file).catch(() => {});
      await pause(50);
    }
  }
  if (!handle) throw Error('Codex project registration is busy; retry');
  try { return await fn(); } finally { await handle.close(); await fs.unlink(file).catch(() => {}); }
}

export function isDesktopExecutable(file, platform = process.platform) {
  const p = file.replace(/\\/g, '/');
  if (platform === 'win32') {
    if (/(?:\/bin\/|\/node_modules\/|\/vendor\/)/i.test(p)) return false;
    return /\/OpenAI[./]Codex(?:_[^/]+)?\/.*\/(?:ChatGPT|Codex)\.exe$/i.test(p)
      || /\/(?:OpenAI\/)?Codex\/(?:app-[^/]+\/)?(?:ChatGPT|Codex)\.exe$/i.test(p);
  }
  return /\/(?:Codex|ChatGPT)\.app\/Contents\/MacOS\/(?:Codex|ChatGPT)$/.test(p) || /\/opt\/(?:codex|Codex)\/(?:codex|Codex)$/.test(p);
}

export async function desktopRunning() {
  if (process.platform === 'win32') {
    const powershell = powershellExe();
    const script = "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process -Filter \"Name='ChatGPT.exe' OR Name='Codex.exe'\" | Select-Object Name,ExecutablePath) | ConvertTo-Json -Compress";
    const r = await exec(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000 });
    const parsed = JSON.parse(r.stdout.trim() || '[]');
    const processes = Array.isArray(parsed) ? parsed : [parsed];
    if (processes.some(p => p.ExecutablePath && isDesktopExecutable(p.ExecutablePath))) return true;
    if (processes.some(p => !p.ExecutablePath || !knownCli(p.ExecutablePath))) throw Error('Could not determine whether Codex desktop has exited; sidebar state was left unchanged');
    return false;
  }
  const r = await exec('/bin/ps', ['-axo', 'comm='], { timeout: 10000 });
  const commands = r.stdout.split('\n').map(line => line.trim()).filter(Boolean);
  if (commands.some(line => isDesktopExecutable(line))) return true;
  if (commands.some(line => /(?:^|\/)(?:codex|Codex|ChatGPT)$/.test(line) && !knownCli(line))) throw Error('Could not determine whether Codex desktop has exited; sidebar state was left unchanged');
  return false;
}

/** Gecko terminates a subprocess's entire Windows job when the parent exits.
 * Node's `detached` flag does not break away from that job. The job explicitly
 * permits breakaway, so launch the waiting worker with the Win32 flag.
 */
export async function launchWorker(home) {
  const module = fileURLToPath(import.meta.url);
  if (process.platform !== 'win32') {
    const child = spawn(process.execPath, [module, '--worker', home], { detached: true, stdio: 'ignore' });
    child.on('error', () => {}); child.unref(); return;
  }
  const quote = arg => `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
  const ps = value => `'${value.replace(/'/g, "''")}'`;
  const command = [process.execPath, module, '--worker', home].map(quote).join(' ');
  const script = `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.ComponentModel;
public static class ZoteroProjectWorker {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct StartupInfo {
    public int cb; public IntPtr reserved, desktop, title;
    public int x,y,xSize,ySize,xChars,yChars,fill,flags;
    public short show,reservedSize; public IntPtr reservedData,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct ProcessInfo { public IntPtr process,thread; public int pid,tid; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref StartupInfo startup, out ProcessInfo process);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static int Start(string app, string command) {
    var si=new StartupInfo(); si.cb=Marshal.SizeOf(si); ProcessInfo pi;
    if(!CreateProcessW(app,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,0x09000000,IntPtr.Zero,null,ref si,out pi)) throw new Win32Exception(Marshal.GetLastWin32Error());
    CloseHandle(pi.thread); CloseHandle(pi.process); return pi.pid;
  }
}
'@
[ZoteroProjectWorker]::Start(${ps(process.execPath)},${ps(command)})
`;
  await exec(powershellExe(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000 });
}

function validateRequest(req) {
  if (!object(req) || typeof req.backendProjectId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(req.backendProjectId)
      || typeof req.projectName !== 'string' || !req.projectName.trim() || !Array.isArray(req.roots) || !req.roots.length || !req.roots.every(r => typeof r === 'string' && path.isAbsolute(r))) throw Error('Invalid Codex desktop project request');
}
function registered(state, req, home) {
  if (!object(state)) return false;
  const mapping = state['app-server-project-id-by-legacy-project-id-by-host']?.[`local:${home}`] || {};
  return Object.values(state['local-projects'] || {}).some(p => object(p) && (p.id === req.backendProjectId || mapping[p.id] === req.backendProjectId)
    && Array.isArray(p.rootPaths) && req.roots.every(root => p.rootPaths.some(r => pathKey(r) === pathKey(root))));
}

/** Pure merge: preserve unrelated projects, settings, order and memberships. */
export function mergeDesktopState(state, req, home) {
  validateRequest(req);
  if (!object(state)) throw Error('Codex desktop state is not a JSON object');
  for (const field of ['local-projects', 'app-server-project-id-by-legacy-project-id-by-host', 'thread-project-assignments', 'thread-project-membership-host-ids']) {
    if (state[field] !== undefined && !object(state[field])) throw Error(`Unsupported Codex desktop state: ${field}`);
  }
  for (const field of ['project-order', 'projectless-thread-ids']) if (state[field] !== undefined && !Array.isArray(state[field])) throw Error(`Unsupported Codex desktop state: ${field}`);
  const next = structuredClone(state), identity = `local:${home}`;
  const projects = next['local-projects'] ||= {};
  const mappings = next['app-server-project-id-by-legacy-project-id-by-host'] ||= {};
  const mapping = mappings[identity] ||= {};
  const old = Object.values(projects).find(p => object(p) && (p.id === req.backendProjectId || mapping[p.id] === req.backendProjectId));
  const id = old?.id || req.backendProjectId;
  const roots = [...(old?.rootPaths || [])];
  for (const root of req.roots) if (!roots.some(r => pathKey(r) === pathKey(root))) roots.push(root);
  projects[id] = { ...old, id, name: old?.name || req.projectName, rootPaths: roots, createdAt: old?.createdAt || Date.now(), updatedAt: Date.now() };
  mapping[id] = req.backendProjectId;
  const order = next['project-order'] ||= [];
  if (!order.includes(id)) order.push(id);
  const assignments = next['thread-project-assignments'] ||= {};
  const hosts = next['thread-project-membership-host-ids'] ||= {};
  const ids = new Set((req.sessionIds || []).filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)));
  for (const session of ids) { assignments[session] = { projectKind: 'local', projectId: id }; hosts[session] = 'local'; }
  if (next['projectless-thread-ids']) next['projectless-thread-ids'] = next['projectless-thread-ids'].filter(id => !ids.has(id));
  return next;
}

export async function flushQueue(home, options = {}) {
  const directory = path.join(home, 'integrations', 'zotero-agent');
  const running = options.isRunning || desktopRunning;
  if (await running()) return false;
  return lock(directory, 'sidebar.lock', async () => {
    if (await running()) return false;
    const queueFile = path.join(directory, 'sidebar-requests.json');
    const queue = await readJSON(queueFile, { projects: {} });
    if (!object(queue.projects)) throw Error('Unsupported Codex sidebar queue');
    const file = path.join(home, '.codex-global-state.json');
    let raw; try { raw = await fs.readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
    let state = JSON.parse(raw), changed = false;
    for (const req of Object.values(queue.projects)) {
      validateRequest(req);
      if (registered(state, req, home)) continue;
      state = mergeDesktopState(state, req, home); changed = true;
    }
    if (changed) {
      try { await fs.writeFile(`${file}.zotero-agent.bak`, raw, { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      if (await running() || await fs.readFile(file, 'utf8') !== raw) return false;
      await atomic(file, JSON.stringify(state));
    }
    // Completed requests must not resurrect a project the user later deletes.
    if (Object.keys(queue.projects).length) await atomic(queueFile, JSON.stringify({ ...queue, projects: {} }));
    return true;
  });
}

export async function registerDesktopProject(req, options = {}) {
  validateRequest(req);
  const home = await fs.realpath(path.resolve(options.home || process.env.CODEX_HOME || path.join(os.homedir(), '.codex')));
  const directory = path.join(home, 'integrations', 'zotero-agent');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(home, '.codex-global-state.json');
  if (registered(await readJSON(file, undefined), req, home)) return { syncPending: false };
  await lock(directory, 'sidebar.lock', async () => {
    const queueFile = path.join(directory, 'sidebar-requests.json');
    const queue = await readJSON(queueFile, { projects: {} });
    if (!object(queue.projects)) throw Error('Unsupported Codex sidebar queue');
    const old = queue.projects[req.backendProjectId];
    queue.projects[req.backendProjectId] = { ...req, sessionIds: [...new Set([...(old?.sessionIds || []), ...(req.sessionIds || [])])], roots: [...new Set([...(old?.roots || []), ...req.roots])] };
    await atomic(queueFile, JSON.stringify(queue));
  });
  if (await flushQueue(home, options)) return { syncPending: false };
  if (options.worker !== false) {
    // A single detached helper waits for a safe offline interval. It does not
    // close the user's app or rewrite a running desktop's cached configuration.
    await launchWorker(home);
  }
  return { syncPending: true, syncReason: 'Codex 原生项目已保存；桌面侧栏登记正在等待客户端完全退出。请退出 Codex，等待约 5 秒后重新打开。' };
}

export async function worker(home) {
  const directory = path.join(home, 'integrations', 'zotero-agent');
  const file = path.join(directory, 'sidebar-worker.json');
  let handle;
  try { handle = await fs.open(file, 'wx', 0o600); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const old = await readJSON(file, {}).catch(() => undefined);
    if (!old) { const stat = await fs.stat(file).catch(() => undefined); if (stat && Date.now() - stat.mtimeMs < 5000) return; }
    if (old && Date.now() - old.startedAt < 4 * 60 * 60 * 1000) {
      try { process.kill(old.pid, 0); return; } catch {}
    }
    await fs.unlink(file).catch(() => {});
    return worker(home);
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    const end = Date.now() + 4 * 60 * 60 * 1000;
    do { if (await flushQueue(home)) return; await pause(2000); } while (Date.now() < end);
  } finally { await handle.close(); await fs.unlink(file).catch(() => {}); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const run = process.argv[2] === '--worker' ? worker(process.argv[3]) : fs.readFile(process.argv[3], 'utf8').then(JSON.parse).then(s => registerDesktopProject(s));
  run.then(result => { if (result) console.log(JSON.stringify(result)); }).catch(e => { console.error(String(e.message || e)); process.exitCode = 1; });
}
