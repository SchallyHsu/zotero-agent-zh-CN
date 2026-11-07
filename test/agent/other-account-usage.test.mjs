import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { claudeUsage, antigravityUsage, codexOAuthUsage, copilotUsage, googleUsage, deepseekUsage, readOtherAccountUsage } from '../../assets/account-usage.mjs';

test('provider formats preserve zero, shared pools, optional windows and exact currency balances', () => {
  const claude = claudeUsage({ five_hour: { utilization: 0, resets_at: '2027-01-01T00:00:00Z' }, seven_day: { utilization: 67.5 }, seven_day_sonnet: { utilization: 10 } });
  assert.equal(claude.windows.length, 3);
  assert.equal(claude.windows[0].usedPercent, 0);
  assert.equal(claude.windows[0].resetsAt, Date.parse('2027-01-01T00:00:00Z'));
  const quota = { response: { groups: [{ displayName: 'Claude models', buckets: [{ bucketId: '5h', displayName: '5小时', remainingFraction: .73 }] }] } };
  const status = { userStatus: { planStatus: { planInfo: { planName: 'AI Pro' } }, cascadeModelConfigData: { clientModelConfigs: [{ modelId: 'same-pool', quotaInfo: { remainingFraction: .73 } }] } } };
  assert.equal(antigravityUsage(quota, status).windows.length, 1);
  assert.equal(antigravityUsage({}, status).windows.length, 1);
  assert.equal(antigravityUsage(quota, status).plan, 'AI Pro');
  assert.equal(codexOAuthUsage({ rate_limit: { primary_window: { used_percent: 50, limit_window_seconds: 18000, reset_at: 1800000000 } } }).windows[0].label, '5小时');
  assert.equal(copilotUsage({ quota_snapshots: { chat: { unlimited: true }, premium_interactions: { percent_remaining: 90 } } }).balances[0].remaining, '不限量');
  assert.equal(googleUsage({ buckets: [{ modelId: 'gemini', remainingFraction: 0 }] }, 'Gemini CLI').windows[0].usedPercent, 100);
  assert.equal(deepseekUsage({ normal_wallets: [{ currency: 'CNY', balance: '0.00000001' }], bonus_wallets: [{ currency: 'USD', balance: '0' }] }, true).balances[0].remaining, '0.00000001');
  for (const parse of [claudeUsage, antigravityUsage, codexOAuthUsage, copilotUsage, googleUsage, deepseekUsage]) assert.equal(parse({}).status, 'unavailable');
});

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'zmc-usage-'));
  t.after(async () => { assert(path.resolve(home).startsWith(path.resolve(os.tmpdir()) + path.sep + 'zmc-usage-')); await fs.rm(home, { recursive: true, force: true }); });
  const write = async (name, value) => { const file = path.join(home, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value)); return file; };
  return { home, write };
}

test('Claude uses its configured credential only and never modifies or exposes it', async t => {
  const f = await fixture(t), config = path.join(f.home, 'custom-claude');
  const file = await f.write('custom-claude/.credentials.json', { claudeAiOauth: { accessToken: 'SECRET-CLAUDE', expiresAt: Date.now() + 60000 } });
  const before = await fs.readFile(file, 'utf8');
  const result = await readOtherAccountUsage({ backend: 'claude-code' }, { home: f.home, env: { CLAUDE_CONFIG_DIR: config }, fetch: async (url, init) => {
    assert.equal(url, 'https://api.anthropic.com/api/oauth/usage');
    assert.equal(init.headers.Authorization, 'Bearer SECRET-CLAUDE');
    assert.equal(init.redirect, 'error');
    return new Response(JSON.stringify({ five_hour: { utilization: 22 } }));
  } });
  assert.equal(result.status, 'available');
  assert(!JSON.stringify(result).includes('SECRET'));
  assert.equal(await fs.readFile(file, 'utf8'), before);
});

test('pi selects the active provider credential, not the native Codex or Claude account', async t => {
  const f = await fixture(t);
  await f.write('.pi/agent/auth.json', { anthropic: { type: 'oauth', access: 'SECRET-PI', expires: Date.now() + 60000 }, 'openai-codex': { type: 'oauth', access: 'OTHER-ACCOUNT' } });
  let called = 0;
  const result = await readOtherAccountUsage({ backend: 'pi', model: 'anthropic/claude-sonnet' }, { home: f.home, env: {}, fetch: async (url, init) => {
    called++;
    assert.equal(url, 'https://api.anthropic.com/api/oauth/usage');
    assert.equal(init.headers.Authorization, 'Bearer SECRET-PI');
    return new Response(JSON.stringify({ seven_day: { utilization: 30 } }));
  } });
  assert.equal(called, 1);
  assert.equal(result.provider, 'Claude');
  assert(!JSON.stringify(result).includes('SECRET'));
});

test('Antigravity queries read-only local services and preserves shared grouping', async () => {
  const methods = [];
  const result = await readOtherAccountUsage({ backend: 'antigravity' }, { service: { call: async method => {
    methods.push(method);
    return method === 'RetrieveUserQuotaSummary' ? { response: { groups: [{ displayName: 'Gemini', buckets: [{ bucketId: 'weekly', remainingFraction: .6 }] }] } } : {};
  } } });
  assert.deepEqual(methods.sort(), ['GetUserStatus', 'RetrieveUserQuotaSummary']);
  assert.equal(result.status, 'available');
});

test('pi Google and DeepSeek API credentials only reach their corresponding fixed quota endpoints', async t => {
  const f = await fixture(t);
  await f.write('.pi/agent/auth.json', { 'google-gemini-cli': { type: 'oauth', access: 'SECRET-GOOGLE', projectId: 'project-fixture' }, deepseek: { type: 'api_key', key: 'KEY_FROM_ENV' } });
  const google = await readOtherAccountUsage({ backend: 'pi', model: 'google-gemini-cli/gemini' }, { home: f.home, env: {}, fetch: async (url, init) => {
    assert.equal(url, 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota');
    assert.deepEqual(JSON.parse(init.body), { project: 'project-fixture' });
    return new Response(JSON.stringify({ buckets: [{ modelId: 'gemini', remainingFraction: .5 }] }));
  } });
  assert.equal(google.status, 'available');
  const deepseek = await readOtherAccountUsage({ backend: 'pi', model: 'deepseek/v4' }, { home: f.home, env: { KEY_FROM_ENV: 'SECRET-KEY' }, fetch: async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/user/balance');
    assert.equal(init.headers.Authorization, 'Bearer SECRET-KEY');
    return new Response(JSON.stringify({ balance_infos: [{ currency: 'USD', total_balance: '0.00' }] }));
  } });
  assert.equal(deepseek.billing, 'api-key');
  assert.equal(deepseek.balances[0].remaining, '0.00');
});

test('DSH wallet grant remains bound to its issuer and does not expose stored secrets', async t => {
  const f = await fixture(t);
  const file = await f.write('.dsh/.credentials.yaml', { records: { 'deepseek-account-platform/default': { kind: 'grant', payload: { token: 'SECRET-DSH', issuer: 'https://platform.deepseek.com' } } } });
  const result = await readOtherAccountUsage({ backend: 'deepseek-harness', model: 'deepseek-official/deepseek-v4-pro' }, { home: f.home, env: {}, yaml: { parse: JSON.parse }, fetch: async (url, init) => {
    assert.equal(url, 'https://platform.deepseek.com/api/v0/users/get_user_summary');
    assert.equal(init.headers['x-dsh-auth-token'], 'SECRET-DSH');
    return new Response(JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: { normal_wallets: [{ currency: 'CNY', balance: '12.34' }], bonus_wallets: [{ currency: 'CNY', balance: '0' }] } } }));
  } });
  assert.equal(result.status, 'available');
  assert.equal(result.balances.length, 2);
  assert(!JSON.stringify(result).includes('SECRET'));
  await fs.writeFile(file, JSON.stringify({ records: { 'deepseek-account-platform/default': { kind: 'grant', payload: { token: 'SECRET-DSH', issuer: 'https://unrelated.invalid' } } } }));
  const denied = await readOtherAccountUsage({ backend: 'deepseek-harness', model: 'deepseek-official/v4' }, { home: f.home, env: {}, yaml: { parse: JSON.parse }, fetch: () => { throw Error('must not send to unrelated host'); } });
  assert.equal(denied.status, 'unsupported');
});

test('DSH third-party and Copilot route their own credentials; expired and throttled states are explicit', async t => {
  const f = await fixture(t);
  await f.write('.dsh/.credentials.yaml', { records: { 'llm-pi-ai/openai-codex': { kind: 'grant', payload: { type: 'oauth', access: 'SECRET-CODEX', accountId: 'account-fixture' } } } });
  const result = await readOtherAccountUsage({ backend: 'deepseek-harness', model: 'openai-codex/gpt-5' }, { home: f.home, env: {}, yaml: { parse: JSON.parse }, fetch: async (url, init) => {
    assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
    assert.equal(init.headers['ChatGPT-Account-Id'], 'account-fixture');
    return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 10 } } }));
  } });
  assert.equal(result.status, 'available');
  await f.write('.pi/agent/auth.json', { 'github-copilot': { type: 'oauth', refresh: 'SECRET-GITHUB', access: 'expired-short-token', expires: 1 } });
  const limited = await readOtherAccountUsage({ backend: 'pi', model: 'github-copilot/gpt-5' }, { home: f.home, env: {}, fetch: async (url, init) => {
    assert.equal(url, 'https://api.github.com/copilot_internal/user');
    assert.equal(init.headers.Authorization, 'token SECRET-GITHUB');
    return new Response('', { status: 429 });
  } });
  assert.equal(limited.status, 'unavailable');
  assert(limited.retryAt > Date.now());
  assert(!JSON.stringify(limited).includes('SECRET'));
  await f.write('.claude/.credentials.json', { claudeAiOauth: { accessToken: 'SECRET-OLD', expiresAt: 1 } });
  const expired = await readOtherAccountUsage({ backend: 'claude-code' }, { home: f.home, env: {}, platform: 'win32', fetch: () => { throw Error('must not query'); } });
  assert.match(expired.message, /过期/);
});
