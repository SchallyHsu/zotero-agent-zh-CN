// Optional read-only probes of the actual installed clients. Missing/expired
// accounts are reported as such; fixtures are covered by test:usage separately.
import { mkdirSync, writeFileSync } from 'node:fs';
import { readOtherAccountUsage } from '../assets/account-usage.mjs';
import { createNodeSpawner } from '../test/node-spawner.ts';
import { findBinary } from '../src/agent/env.ts';
const env = { ...process.env, PATH: process.env.PATH || process.env.Path };
const spawner = { ...createNodeSpawner({ baseEnv: env }), windows: process.platform === 'win32' };
const cli = await findBinary(spawner, env, 'dsh');
const accounts = [];
// dsh ACP reports opaque ["provider","model"] selectors; override with ZMC_DSH_USAGE_MODEL for another route.
const dshModel = process.env.ZMC_DSH_USAGE_MODEL || '["deepseek-official","deepseek-flash"]';
for (const backend of ['claude-code', 'antigravity', 'deepseek-harness', 'pi']) {
  const result = await readOtherAccountUsage({ backend, cli, model: backend === 'deepseek-harness' ? dshModel : process.env.ZMC_PI_USAGE_MODEL });
  accounts.push({ backend, status: result.status, billing: result.billing, windows: result.windows.length, balances: result.balances?.length ?? 0,
    hasResetTime: result.windows.some(w => w.resetsAt !== undefined), ...(result.message ? { message: result.message } : {}) });
}
const report = { completed: true, noModelInference: true, accounts };
mkdirSync('test-output/usage', { recursive: true });
writeFileSync('test-output/usage/native-others.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
