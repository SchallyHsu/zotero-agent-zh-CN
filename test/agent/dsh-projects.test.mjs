import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { enqueueProject, installIntegration, syncRequests } from '../../assets/dsh-project-integration.mjs';

async function fixture(t) {
 const home = await mkdtemp(path.join(os.tmpdir(), 'zmc-dsh-projects-'));
 t.after(async () => { assert(path.resolve(home).startsWith(path.resolve(os.tmpdir())) && path.basename(home).startsWith('zmc-dsh-projects-')); await rm(home, { recursive: true, force: true }); });
 const cwd = path.join(home, 'Zotero Agent'); await mkdir(cwd);
 return { home, cwd, directory: path.join(home, 'integrations/zotero-agent') };
}
test('DSH integration preserves user configuration, keeps a backup, and installs idempotently', async t => {
 const f = await fixture(t);
 const original = '# User settings\n- id: example-user-setting\n  disabled: true\n';
 const file = path.join(f.home, 'cordis.patch.yml'); await writeFile(file, original);
 await installIntegration(f.home);
 const patched = await readFile(file, 'utf8');
 assert(patched.startsWith(original));
 assert(patched.includes("!['web', 'desktop'].includes"));
 assert.equal(await readFile(`${file}.zotero-agent.bak`, 'utf8'), original);
 await installIntegration(f.home); assert.equal(await readFile(file, 'utf8'), patched);
 await writeFile(file, 'not-a-patch-array: true\n');
 await assert.rejects(installIntegration(f.home), /left unchanged/);
 assert.equal(await readFile(file, 'utf8'), 'not-a-patch-array: true\n');
});

test('native registry attaches the requested conversation and earlier conversations in the same directory', async t => {
 const f = await fixture(t);
 const other = path.join(f.home, 'other'); await mkdir(other);
 const request = { agentSessionId: 'current-id', cwd: f.cwd, projectName: 'Zotero 文献', relatedSessionIds: ['old-id'] };
 assert.deepEqual(await enqueueProject(request, { home: f.home, waitMs: 0 }), { syncPending: true });
 const sessions = [{ id: 'old-id', cwd: f.cwd, createdAt: '2026-01-01' }, { id: 'current-id', cwd: f.cwd, createdAt: '2026-01-02' }, { id: 'other-id', cwd: other, createdAt: '2026-01-03' }, { id: 'unrelated-same-cwd', cwd: f.cwd, createdAt: '2026-01-04' }];
 const workspaces = new Map(); let creates = 0;
 const ctx = { sessionPersistence: { list: async () => sessions.map(header => ({ header })) }, workspaceRegistry: {
  resolveByPath: async p => workspaces.get(p),
  create: async (p, title) => {
   creates++; const ws = { id: 'native-project-id', title, sessionIds: [], attachSession: async id => { if (!ws.sessionIds.includes(id)) ws.sessionIds.unshift(id); }, setTitle: async title => { ws.title = title; } };
   workspaces.set(p, ws); return ws;
  },
 } };
 await syncRequests(ctx, f.directory);
 assert.deepEqual(workspaces.get(f.cwd).sessionIds, ['current-id', 'old-id']);
 assert.equal(workspaces.get(f.cwd).title, 'Zotero 文献');
 assert.deepEqual(await enqueueProject(request, { home: f.home, waitMs: 0 }), { backendProjectId: 'native-project-id', syncPending: false });
 await syncRequests(ctx, f.directory); assert.equal(creates, 1);
 assert(!workspaces.has(other));
});

test('a missing native session never produces a successful project acknowledgement', async t => {
 const f = await fixture(t);
 const req = { agentSessionId: 'not-visible-yet', cwd: f.cwd, projectName: 'Zotero Agent' };
 await enqueueProject(req, { home: f.home, waitMs: 0 });
 await syncRequests({ sessionPersistence: { list: async () => [] }, workspaceRegistry: { create: () => { throw Error('must not create'); } } }, f.directory);
 const acks = JSON.parse(await readFile(path.join(f.directory, 'acknowledgements.json'), 'utf8'));
 assert(acks.sessions[req.agentSessionId].error.includes('not yet visible'));
 assert.equal(acks.sessions[req.agentSessionId].workspaceId, undefined);
 const pending = await enqueueProject(req, { home: f.home, waitMs: 0 });
 assert.equal(pending.syncPending, true);
 assert(pending.syncReason.includes('not yet visible'));
});
