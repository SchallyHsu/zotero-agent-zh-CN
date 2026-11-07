// Optional read-only smoke test using the installed Codex and its signed-in account.
// Does not create threads, send prompts or print credentials. No isolated CODEX_HOME:
// this test intentionally needs the account whose quota the user wants to display.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createNodeSpawner } from '../test/node-spawner.ts';
import { shimTarget } from '../src/agent/windows.ts';
import { readAccountUsage } from '../src/agent/account-usage.ts';

const env = { ...process.env, PATH: process.env.PATH || process.env.Path };
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
const result = await readAccountUsage(spawner, 'codex', 'subscription');
const report = { passed: result.status === 'available', status: result.status, windows: result.windows.length,
  hasResetTime: result.windows.some(w => w.resetsAt !== undefined), noModelInference: true,
  ...(!result.windows.length ? { message: result.message } : {}) };
mkdirSync('test-output/usage', { recursive: true });
writeFileSync('test-output/usage/native-codex.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
