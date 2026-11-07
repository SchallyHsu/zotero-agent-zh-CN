// Measures only local metadata preparation. No model request or user data.
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareSession } from '../assets/antigravity-project-integration.mjs';

const home = await mkdtemp(join(tmpdir(), 'zmc-agy-latency-'));
const baseDir = join(home, 'gemini'), cwd = join(home, 'workspace'); await mkdir(cwd);
const initial = await prepareSession({ cwd, projectName: 'Latency fixture' }, { baseDir });
const requestFile = join(home, 'request.json');
async function sample(mode) {
  await writeFile(requestFile, JSON.stringify({ cwd, projectName: 'Latency fixture', agentSessionId: initial.agentSessionId,
    ...(mode === 'confirmed-resume' ? { operation: 'resume', confirmedProjectId: initial.backendProjectId } : {}) }));
  const start = performance.now();
  const child = spawn(process.execPath, [resolve('assets/antigravity-project-integration.mjs'), '--request-file', requestFile], {
    env: { ...process.env, ZOTERO_AGENT_GEMINI_DIR: baseDir }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', resultMs;
  child.stdout.on('data', d => { resultMs ??= performance.now() - start; stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise((r, j) => { child.once('error', j); child.once('close', r); });
  if (code !== 0) throw Error(stderr || `metadata helper exited ${code}`);
  const result = JSON.parse(stdout.trim());
  return { mode, resultMs: Math.round(resultMs), exitMs: Math.round(performance.now() - start), metadataReused: result.metadataReused === true };
}
const report = { scope: 'Local metadata helper process, not model time-to-first-token', modelInference: false,
  samples: [await sample('full-native-sync'), await sample('confirmed-resume'), await sample('confirmed-resume')] };
await mkdir('test-output', { recursive: true });
await writeFile('test-output/antigravity-latency-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
