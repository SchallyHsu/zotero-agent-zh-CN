// Account quota compatibility adapters (AGPL-3.0-or-later).
// Secrets stay in this short-lived process. Only allowlisted provider endpoints
// receive their own credentials; stdout contains normalized quota data only.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {};
const number = v => typeof v === 'number' && Number.isFinite(v);
const list = v => Array.isArray(v) ? v : [];
const text = v => typeof v === 'string' ? v.slice(0, 160) : '';
const unknown = (message, status = 'unavailable') => ({ status, checkedAt: Date.now(), windows: [], message });
const timestamp = v => {
  const n = number(v) ? v * 1000 : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(n) && n > 0 && n < 8.64e15 ? n : undefined;
};
const window = (id, label, used, reset) => number(used) && used >= 0 ? [{ id, label, usedPercent: Math.min(used, 100), ...(timestamp(reset) ? { resetsAt: timestamp(reset) } : {}) }] : [];
function snapshot(windows, extra = {}) {
  return { status: windows.length || extra.balances?.length ? 'available' : 'unavailable', checkedAt: Date.now(), windows,
    ...(!windows.length && !extra.balances?.length ? { message: '服务商未返回有效额度数据。' } : {}), ...extra };
}

export function claudeUsage(value) {
  const data = object(value), windows = [];
  for (const [key, label] of [['five_hour', '5小时'], ['seven_day', '7天'], ['seven_day_sonnet', 'Sonnet · 7天'], ['seven_day_opus', 'Opus · 7天'], ['seven_day_oauth_apps', 'OAuth 应用 · 7天']]) {
    const w = object(data[key]);
    windows.push(...window(key, label, w.utilization ?? w.used_percentage, w.resets_at));
  }
  return snapshot(windows, { provider: 'Claude', billing: 'subscription' });
}

export function antigravityUsage(quota, status) {
  const windows = [];
  const user = object(object(status).userStatus);
  const groups = list(object(object(quota).response).groups ?? object(quota).groups);
  for (const group of groups) for (const b of list(group.buckets)) {
    if (!number(b.remainingFraction) || b.remainingFraction < 0 || b.remainingFraction > 1) continue;
    windows.push(...window(`${text(group.displayName)}/${text(b.bucketId) || text(b.window)}`, `${text(group.displayName)} · ${text(b.displayName) || text(b.window)}`, (1 - b.remainingFraction) * 100, b.resetTime));
  }
  // Older local services only expose per-model quotas. Never duplicate them when grouped quota is available.
  if (!windows.length) for (const m of list(object(user.cascadeModelConfigData).clientModelConfigs)) {
    const q = object(m.quotaInfo);
    if (number(q.remainingFraction) && q.remainingFraction >= 0 && q.remainingFraction <= 1)
      windows.push(...window(text(m.modelId) || text(m.label), text(m.label) || text(m.modelId), (1 - q.remainingFraction) * 100, q.resetTime));
  }
  const plan = text(object(object(user.planStatus).planInfo).planName) || text(object(user.userTier).name);
  return snapshot(windows, { provider: 'Antigravity', billing: 'subscription', ...(plan ? { plan } : {}) });
}

export function codexOAuthUsage(value) {
  const data = object(value), windows = [];
  const bucket = (id, name, rate) => {
    for (const key of ['primary_window', 'secondary_window']) {
      const w = object(object(rate)[key]);
      const seconds = w.limit_window_seconds;
      const length = number(seconds) && seconds > 0 ? seconds % 86400 === 0 ? `${seconds / 86400}天` : seconds % 3600 === 0 ? `${seconds / 3600}小时` : `${seconds / 60}分钟` : key === 'primary_window' ? '主要额度' : '次要额度';
      windows.push(...window(`${id}/${key}`, `${name}${length}`, w.used_percent, w.reset_at));
    }
  };
  bucket('codex', '', data.rate_limit);
  for (const entry of list(data.additional_rate_limits)) bucket(text(entry.limit_name) || text(entry.metered_feature), `${text(entry.limit_name) || text(entry.metered_feature)} · `, entry.rate_limit);
  return snapshot(windows, { provider: 'ChatGPT / Codex', billing: 'subscription', ...(text(data.plan_type) ? { plan: text(data.plan_type) } : {}) });
}

export function copilotUsage(value) {
  const data = object(value), windows = [], balances = [];
  for (const [key, label] of [['premium_interactions', '高级请求'], ['chat', '聊天'], ['completions', '代码补全']]) {
    const q = object(object(data.quota_snapshots)[key]);
    if (q.unlimited === true) { balances.push({ label, remaining: '不限量' }); continue; }
    if (number(q.percent_remaining) && q.percent_remaining >= 0 && q.percent_remaining <= 100)
      windows.push(...window(key, label, 100 - q.percent_remaining, data.quota_reset_date));
  }
  return snapshot(windows, { provider: 'GitHub Copilot', billing: 'subscription', balances, ...(text(data.copilot_plan) ? { plan: text(data.copilot_plan) } : {}) });
}

export function googleUsage(value, provider) {
  const data = object(value), windows = [];
  for (const b of list(data.buckets)) {
    if (number(b.remainingFraction) && b.remainingFraction >= 0 && b.remainingFraction <= 1)
      windows.push(...window(`${text(b.modelId)}/${text(b.tokenType)}`, text(b.modelId) || '模型额度', (1 - b.remainingFraction) * 100, b.resetTime));
  }
  if (!windows.length) for (const [id, m] of Object.entries(object(data.models))) {
    const q = object(object(m).quotaInfo);
    if (number(q.remainingFraction) && q.remainingFraction >= 0 && q.remainingFraction <= 1)
      windows.push(...window(id, text(m.displayName) || id, (1 - q.remainingFraction) * 100, q.resetTime));
  }
  return snapshot(windows, { provider, billing: 'subscription' });
}

export function deepseekUsage(value, account = false) {
  const data = object(value), balances = [];
  const money = (v, currency, label) => {
    if ((typeof v === 'string' && /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v) || number(v)) && ['CNY', 'USD'].includes(currency))
      balances.push({ label, remaining: String(v), currency });
  };
  if (account) {
    for (const w of list(data.normal_wallets)) money(w.balance, w.currency, '充值余额');
    for (const w of list(data.bonus_wallets)) money(w.balance, w.currency, '赠送余额');
  } else {
    for (const w of list(data.balance_infos)) money(w.total_balance, w.currency, '账户余额');
  }
  return snapshot([], { provider: 'DeepSeek', billing: account ? 'account' : 'api-key', balances });
}

async function readJSON(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw Error('credential-format'); }
}

async function request(url, init = {}, options = {}) {
  const response = await (options.fetch ?? fetch)(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok) { await response.body?.cancel(); throw Error(`http-${response.status}`); }
  const reader = response.body?.getReader();
  if (!reader) throw Error('empty-response');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) throw Error('oversized-response');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function nativeClaude(options) {
  const env = options.env ?? process.env;
  let credential = object((await readJSON(path.join(env.CLAUDE_CONFIG_DIR || path.join(options.home || os.homedir(), '.claude'), '.credentials.json'))).claudeAiOauth);
  if (!credential.accessToken && (options.platform ?? process.platform) === 'darwin' && !env.CLAUDE_CONFIG_DIR) {
    try { const r = await exec('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000 }); credential = object(JSON.parse(r.stdout).claudeAiOauth); } catch {}
  }
  const token = env.CLAUDE_CODE_OAUTH_TOKEN || credential.accessToken;
  if (!token) return unknown('未找到 Claude 订阅登录，请先在 Claude Code 中登录。');
  if (!env.CLAUDE_CODE_OAUTH_TOKEN && number(credential.expiresAt) && credential.expiresAt <= Date.now()) return unknown('Claude 登录已过期，请在 Claude Code 中刷新登录后重试。');
  return claudeUsage(await request('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'claude-code/zotero-agent-usage' } }, options));
}

/** Resolves only installed DSH's YAML parser. No user code or shell-key interpolation is executed. */
async function dshCredentials(cli, options) {
  const home = (options.env ?? process.env).DSH_HOME || path.join(options.home || os.homedir(), '.dsh');
  let source;
  try { source = await fs.readFile(path.join(home, '.credentials.yaml'), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  let yaml = options.yaml;
  if (!yaml) {
    if (!cli) throw Error('dsh-not-found');
    const real = await fs.realpath(cli);
    const candidates = [path.join(path.dirname(cli), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), path.resolve(path.dirname(real), '..', 'package.json')];
    for (const file of candidates) try { yaml = createRequire(file)('yaml'); break; } catch {}
    if (!yaml) throw Error('dsh-parser-missing');
  }
  return object(yaml.parse(source));
}

/**
 * ACP model selectors: dsh sends an opaque JSON pair (`["provider","model"]`, 0.2.2+),
 * pi sends `provider/model`, and older clients send a bare model id.
 */
export function modelRoute(value) {
  if (typeof value !== 'string') return {};
  const text = value.trim();
  if (!text) return {};
  if (text.startsWith('[')) {
    try {
      const pair = JSON.parse(text);
      if (Array.isArray(pair) && pair.length === 2 && pair.every(x => typeof x === 'string' && x))
        return { provider: pair[0], model: pair[1] };
    } catch {}
  }
  const slash = text.indexOf('/');
  return slash > 0 ? { provider: text.slice(0, slash), model: text.slice(slash + 1) } : { model: text };
}

/** dsh stores the signed-in account grant under its platform scope, independent of model routes. */
function dshAccountGrant(records) {
  const direct = object(records['deepseek-account-platform/default']);
  if (direct.kind === 'grant') return direct;
  for (const [key, record] of Object.entries(records)) if (record?.kind === 'grant' && /^deepseek-account(?:-platform)?\//.test(key)) return record;
  return undefined;
}

/** `deepseek-account` asks the DeepSeek platform for the signed-in wallet balances. */
async function deepseekAccountBalance(records, options) {
  const grant = object(dshAccountGrant(records)?.payload);
  if (typeof grant.token !== 'string' || !grant.token) return unknown('未找到 DeepSeek Harness 账号登录，请先在 dsh 中登录。');
  // Match the grant to its issuer; custom hosts are never sent credentials.
  const issuer = typeof grant.issuer === 'string' ? grant.issuer.replace(/\/+$/, '') : '';
  if (issuer !== 'https://platform.deepseek.com') return unknown('当前 DeepSeek 账号来源暂不支持余额查询。', 'unsupported');
  const response = await request('https://platform.deepseek.com/api/v0/users/get_user_summary', { headers: { 'x-dsh-auth-token': grant.token, 'x-client-platform': 'web', 'x-client-version': '0.2.2', 'x-client-locale': 'zh_CN' } }, options);
  if (response.code !== 0 || response.data?.biz_code !== 0) throw Error('provider-response');
  return deepseekUsage(response.data.biz_data, true);
}

/** A stored secret is used as-is; `$NAME` and a plain name resolve from the launch environment, never executed. */
function credentialValue(reference, env) {
  if (typeof reference !== 'string' || !reference || reference.startsWith('!')) return undefined;
  if (reference.startsWith('$')) return env[reference.slice(1)] || undefined;
  return env[reference] || reference;
}

/** `deepseek-official` (and the legacy pi route named `deepseek`) bills the stored API key. */
async function deepseekApiKeyBalance(refs, options) {
  const env = options.env ?? process.env;
  const stored = object(refs).DEEPSEEK_API_KEY;
  const key = credentialValue(stored, env) ?? credentialValue(env.DEEPSEEK_API_KEY, env);
  if (!key) return unknown('未找到 DeepSeek API 密钥，请在 dsh 中配置 DEEPSEEK_API_KEY 后重试。', 'api-key');
  return deepseekUsage(await request('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${key}` } }, options));
}

async function providerUsage(provider, credential, options) {
  if (!credential && provider === 'deepseek' && (options.env ?? process.env).DEEPSEEK_API_KEY) credential = { type: 'api_key', key: (options.env ?? process.env).DEEPSEEK_API_KEY };
  if (!credential) return unknown(`未找到 ${provider} 的登录，请先在当前后端登录此服务商。`);
  const c = object(credential), token = c.access || c.accessToken;
  if (c.type === 'api_key') {
    // Resolve stored environment references, but never evaluate shell-command keys.
    const env = options.env ?? process.env;
    const value = typeof c.key === 'string' && !c.key.startsWith('!') ? env[c.key] || c.key : undefined;
    if (provider === 'deepseek' && value) return deepseekUsage(await request('https://api.deepseek.com/user/balance', { headers: { Authorization: `Bearer ${value}` } }, options));
    return unknown(`${provider} 当前使用 API 密钥；账户额度请在服务商控制台查看。`, 'api-key');
  }
  if (provider !== 'github-copilot' && number(c.expires) && c.expires <= Date.now()) return unknown(`${provider} 登录已过期，请在当前后端刷新登录后重试。`);
  if (provider === 'anthropic' && token) return claudeUsage(await request('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' } }, options));
  if (provider === 'openai-codex' && token) {
    const headers = { Authorization: `Bearer ${token}` };
    let accountId = c.accountId;
    if (!accountId) try { accountId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).auth?.chatgpt_account_id || JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())['https://api.openai.com/auth']?.chatgpt_account_id; } catch {}
    if (accountId) headers['ChatGPT-Account-Id'] = accountId;
    return codexOAuthUsage(await request('https://chatgpt.com/backend-api/wham/usage', { headers }, options));
  }
  if (provider === 'github-copilot' && (c.refresh || token)) {
    if (c.enterpriseUrl) return unknown('当前 GitHub Enterprise 账号暂不支持额度查询。', 'unsupported');
    return copilotUsage(await request('https://api.github.com/copilot_internal/user', { headers: { Authorization: `token ${c.refresh || token}`, Accept: 'application/json', 'User-Agent': 'Zotero-Agent' } }, options));
  }
  if (['google-gemini-cli', 'google-antigravity'].includes(provider) && token) {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'antigravity' };
    const base = provider === 'google-antigravity' ? 'https://daily-cloudcode-pa.googleapis.com/v1internal:' : 'https://cloudcode-pa.googleapis.com/v1internal:';
    const data = await request(base + (provider === 'google-antigravity' ? 'fetchAvailableModels' : 'retrieveUserQuota'), { method: 'POST', headers, body: JSON.stringify(c.projectId ? { project: c.projectId } : {}) }, options);
    return googleUsage(data, provider === 'google-antigravity' ? 'Antigravity' : 'Gemini CLI');
  }
  return unknown(`${provider} 暂无可用的账号额度接口。`, 'unsupported');
}

export async function readOtherAccountUsage(input, options = {}) {
  try {
    if (input.backend === 'claude-code') return await nativeClaude(options);
    if (input.backend === 'antigravity') {
      const { withService } = await import('./antigravity-project-integration.mjs');
      const baseDir = (options.env ?? process.env).ZOTERO_AGENT_GEMINI_DIR || path.join(options.home || os.homedir(), '.gemini');
      return await withService(baseDir, async call => {
        const [quota, status] = await Promise.allSettled([call('RetrieveUserQuotaSummary', {}), call('GetUserStatus', {})]);
        return antigravityUsage(quota.status === 'fulfilled' ? quota.value : {}, status.status === 'fulfilled' ? status.value : {});
      }, options.service ?? {});
    }
    if (input.backend === 'pi') {
      const directory = (options.env ?? process.env).PI_CODING_AGENT_DIR || path.join(options.home || os.homedir(), '.pi', 'agent');
      const auth = await readJSON(path.join(directory, 'auth.json'));
      const provider = input.model?.includes('/') ? input.model.split('/')[0] : (await readJSON(path.join(directory, 'settings.json'))).defaultProvider;
      if (!provider) return unknown('请选择具体的 pi 模型后查看对应服务商额度。');
      return await providerUsage(provider, auth[provider], options);
    }
    if (input.backend === 'deepseek-harness') {
      const route = modelRoute(input.model);
      if (!route.model) return unknown('请选择具体的 dsh 模型后查看对应账号额度。');
      const data = await dshCredentials(input.cli, options), records = object(data.records), refs = object(data.refs);
      // dsh registers one route per credential source; the ACP selector names it exactly.
      if (route.provider === 'deepseek-account') return await deepseekAccountBalance(records, options);
      if (route.provider === 'deepseek-official') return await deepseekApiKeyBalance(refs, options);
      if (route.provider === 'deepseek') {
        const r = object(records['llm-pi-ai/deepseek']);
        return r.kind === 'grant' ? await providerUsage('deepseek', r.payload, options)
          : r.kind === 'api-key' ? await providerUsage('deepseek', { type: 'api_key', key: r.key }, options)
          : await deepseekApiKeyBalance(refs, options);
      }
      if (route.provider) {
        const r = object(records[`llm-pi-ai/${route.provider}`]);
        return await providerUsage(route.provider, r.kind === 'grant' ? r.payload : r.kind === 'api-key' ? { type: 'api_key', key: r.key } : undefined, options);
      }
      if (!/^deepseek[-/]/i.test(route.model)) return unknown('当前 dsh 模型路由无法确定账号，请选择具体服务商模型后重试。', 'unsupported');
      // Older clients saved bare DeepSeek model ids; the platform account is the closest match.
      return dshAccountGrant(records) ? await deepseekAccountBalance(records, options) : await deepseekApiKeyBalance(refs, options);
    }
    return unknown('此后端暂不支持账号额度查询。', 'unsupported');
  } catch (e) {
    const message = e.message === 'http-401' ? '登录已过期，请在当前后端重新登录后刷新。'
      : e.message === 'http-403' ? '当前登录无权查询额度，请检查账号权限。'
      : e.message === 'http-429' ? '额度查询过于频繁，稍后将自动重试。'
      : '暂时无法获取额度，请检查当前后端登录状态和网络后刷新。';
    return { ...unknown(message), ...(e.message === 'http-429' ? { retryAt: Date.now() + 300_000 } : {}) };
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  readOtherAccountUsage(JSON.parse(process.argv[2] || '{}')).then(r => console.log(JSON.stringify(r)))
    .catch(() => { console.log(JSON.stringify(unknown('额度查询失败，请检查后端配置。'))); });
}
