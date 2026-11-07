// Optional native control-plane check: isolated DSH home, no prompt/model inference.
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { createNodeSpawner } from '../test/node-spawner.ts';
import { createRuntime } from '../src/agent/runtime.ts';
import { shimTarget } from '../src/agent/windows.ts';
const cwd = mkdtempSync(join(tmpdir(), 'zmc-dsh-acp-'));
const env = { ...process.env, PATH: process.env.PATH || process.env.Path, DSH_HOME: cwd, AGENTS_HOME: join(cwd, 'agents'), HOME: cwd, USERPROFILE: cwd };
for (const key of Object.keys(env)) if (/^(DEEPSEEK|OPENAI|ANTHROPIC|GEMINI|GOOGLE|CODEX).*KEY$/.test(key)) delete env[key];
const entry = process.env.ZMC_DSH_ENTRY ? resolve(process.env.ZMC_DSH_ENTRY) : undefined;
const executable = entry ? process.execPath : process.env.ZMC_DSH_EXECUTABLE;
const base = createNodeSpawner({ baseEnv: env, graceMs: 500 });
const spawner = { ...base, windows: process.platform === 'win32', spawn(command, args, opts) {
 if (entry && command === process.execPath) return base.spawn(command, [entry, ...args], opts);
 if (process.platform === 'win32' && /\.cmd$/i.test(command)) {
  const target = shimTarget(readFileSync(command, 'utf8'));
  if (!target) throw new Error('Unrecognised dsh CLI shim');
  return base.spawn(process.execPath, [join(dirname(command), ...target.split('\\')), ...args], opts);
 }
 return base.spawn(command, args, opts);
} };
const runtime = createRuntime({ spawner, bridgeDir: join(cwd, 'unused'), executable: () => executable, initTimeoutMs: 20000 });
const session = await runtime.start({ backend: 'deepseek-harness', cwd, brief: 'Synthetic ACP metadata fixture; no model requests.' });
const id = session.sessionId;
try {
 assert(session.models().length > 0);
 const efforts = session.efforts();
 if (efforts.length > 1) await session.setEffort(efforts.at(-1).id);
} finally { await session.close(); }
const resumed = await runtime.start({ backend: 'deepseek-harness', cwd, brief: '', resumeSessionId: id });
try { assert.equal(resumed.sessionId, id); assert(resumed.models().length > 0); }
finally { await resumed.close(); }
const report = { passed: true, backend: 'deepseek-harness', isolatedHome: cwd, checks: ['actual native CLI ACP handshake', 'new persistent session', 'grouped model discovery', 'reasoning option update', 'graceful close', 'same session resumed in another process'], modelInference: false };
mkdirSync('test-output', { recursive: true });
writeFileSync('test-output/deepseek-native-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
