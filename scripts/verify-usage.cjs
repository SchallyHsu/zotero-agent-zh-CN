// Synthetic quota/UI regression: no account credentials, real library or model calls.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, writeFileSync } = require('node:fs');
const root = resolve(__dirname, '..');
const out = join(root, 'test-output', 'usage');
mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  const errors = [], checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 }, locale: 'zh-CN' });
    page.setDefaultTimeout(8000);
    page.on('pageerror', e => errors.push(e.message));
    const url = pathToFileURL(join(root, 'preview/dist/index.html')).href;
    const summary = page.locator('.umeter__summary');
    const open = () => page.locator('.umeter__button').click();
    const contains = async (locator, text) => { await locator.filter({ hasText: text }).waitFor(); };
    // The summary lives in the hover tooltip, so it is checked while hidden.
    const says = async (text) => { await summary.filter({ hasText: text }).waitFor({ state: 'attached' }); };
    const summaryText = async () => (await summary.textContent()) ?? '';
    await page.goto(url + '?backend=codex&speed=0&nohistory=1');
    await says('剩余 73%');
    // The compact gauge sits in the toolbar; hover shows the one-line tooltip.
    assert.equal(await page.locator('.ctools .umeter__button').count(), 1);
    await page.locator('.umeter__button').hover();
    await page.locator('.utip').waitFor();
    assert.equal(await page.locator('.utip').innerText(), '5小时 · 剩余 73%');
    await page.screenshot({ path: join(out, 'codex-tooltip.png') });
    checks.push('toolbar gauge with hover tooltip');
    await open();
    assert(await page.locator('.utip').isHidden());
    await contains(page.locator('.upop'), '剩余 92%');
    assert.equal(await page.locator('.upop').getAttribute('role'), 'dialog');
    await page.waitForTimeout(180);
    await page.screenshot({ path: join(out, 'codex-light.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.umeter__button').getAttribute('aria-expanded'), 'false');
    checks.push('account windows, keyboard dismissal and light screenshot');

    // A refresh failure keeps the old snapshot clearly marked; it cannot stop a chat.
    await page.evaluate(() => { window.__zmc.host.runtime.accountUsage = async () => { throw Error('offline'); }; });
    await open();
    await page.locator('.upop').getByRole('button', { name: '刷新', exact: true }).click();
    await says('上次数据');
    await contains(page.locator('.upop'), '上次成功');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const s = window.__zmc.sim.statuses.find(s => s.id === 'codex'); if (s) s.available = true; });
    await page.getByRole('button', { name: '重新检查', exact: true }).click();
    await page.locator('.setupslot').filter({ hasText: '尚无可用' }).waitFor({ state: 'hidden' });
    await page.locator('textarea').fill('给出简短回答');
    await page.locator('textarea').press('Enter');
    await page.waitForFunction(() => window.__zmc.sim.writes.some(w => w.ev.t === 'turn_end'));
    await open();
    await contains(page.locator('.upop'), '13k / 912');
    assert(!(await page.locator('.upop').innerText()).includes('$'));
    checks.push('offline refresh preserves labelled snapshot, sending works, subscription hides API cost');

    // A late reply from the previous auth mode must not overwrite the new mode.
    await page.evaluate(() => {
      window.__zmc.host.runtime.accountUsage = async (_b, auth) => {
        if (auth === 'subscription') return new Promise(resolve => { window.__lateUsage = resolve; });
        return { status: 'api-key', checkedAt: Date.now(), windows: [], message: '账户余额请在服务商控制台查看。' };
      };
    });
    await page.locator('.upop').getByRole('button', { name: '刷新', exact: true }).click();
    await page.evaluate(async () => {
      const host = window.__zmc.host, s = host.getSettings();
      window.__zmc.sim.setSettingsElsewhere({ auth: { ...s.auth, codex: 'api-key' }, showUsage: true });
      window.__lateUsage({ status: 'available', checkedAt: Date.now(), windows: [{ id: 'late', label: '错误旧数据', usedPercent: 99 }] });
    });
    await contains(page.locator('.upop'), 'API 模式');
    await contains(page.locator('.upop'), '$0.0310');
    assert(!(await page.locator('.upop').innerText()).includes('错误旧数据'));
    assert(!(await summaryText()).includes('剩余'));
    checks.push('auth-switch race ignored and API estimated cost follows preference');

    await page.goto(url + '?backend=codex&theme=dark&speed=0&nohistory=1');
    await page.setViewportSize({ width: 320, height: 740 });
    await says('剩余 73%');
    await open();
    const geometry = await page.locator('.upop').evaluate(el => {
      const r = el.getBoundingClientRect(), parent = el.closest('.zmc').getBoundingClientRect();
      return { left: r.left >= parent.left, right: r.right <= parent.right + 1, top: r.top >= parent.top, overflow: el.scrollWidth > el.clientWidth + 1 };
    });
    assert.deepEqual(geometry, { left: true, right: true, top: true, overflow: false });
    await page.waitForTimeout(180);
    await page.screenshot({ path: join(out, 'codex-dark-narrow.png') });
    await page.keyboard.press('Escape');

    // Expired windows are never inferred to have replenished.
    await page.evaluate(() => { window.__zmc.host.runtime.accountUsage = async () => ({ status: 'available', checkedAt: Date.now(), windows: [{ id: 'expired', label: '5小时', usedPercent: 100, resetsAt: Date.now() - 1000 }] }); });
    await open();
    await page.locator('.upop').getByRole('button', { name: '刷新', exact: true }).click();
    await says('待刷新');
    await contains(page.locator('.upop'), '已到重置时间');
    assert(!(await summaryText()).includes('100%'));
    checks.push('320px dark layout and expired-reset state');

    for (const backend of ['claude-code', 'antigravity', 'deepseek-harness']) {
      await page.goto(url + `?backend=${backend}&speed=0&nohistory=1`);
      await says(backend === 'deepseek-harness' ? '23.45' : '剩余 73%');
      await open();
      await contains(page.locator('.upop'), backend === 'deepseek-harness' ? '赠送余额' : '剩余 92%');
      await page.waitForTimeout(180);
      await page.screenshot({ path: join(out, `${backend}.png`) });
    }
    checks.push('Claude, Antigravity and DeepSeek quota/currency panels');

    await page.goto(url + '?backend=pi&speed=0&nohistory=1');
    await says('额度暂不可用');
    await open();
    await contains(page.locator('.upop'), '未提供');
    await contains(page.locator('.upop'), '未报告');
    // The popover sits over the textarea (like the context popover), so click outside the composer instead.
    await page.mouse.click(12, 12);
    assert.equal(await page.locator('.upop').count(), 0);

    // Switching provider/model must clear the old snapshot and discard its late reply.
    await page.evaluate(() => {
      const { host, sim } = window.__zmc;
      host.runtime.accountUsage = async (_backend, _auth, model) => model?.startsWith('anthropic/')
        ? new Promise(resolve => { window.__oldProvider = resolve; })
        : { status: 'available', checkedAt: Date.now(), provider: 'ChatGPT', windows: [{ id: 'pi-codex', label: '新服务商额度', usedPercent: 2 }] };
      const s = host.getSettings();
      sim.setSettingsElsewhere({ model: { ...s.model, pi: 'anthropic/sonnet' } });
    });
    await page.evaluate(() => {
      const { host, sim } = window.__zmc, s = host.getSettings();
      sim.setSettingsElsewhere({ model: { ...s.model, pi: 'openai-codex/gpt-5' } });
      window.__oldProvider({ status: 'available', checkedAt: Date.now(), windows: [{ id: 'wrong', label: '过时服务商额度', usedPercent: 99 }] });
    });
    await says('新服务商额度');
    assert(!(await summaryText()).includes('过时服务商'));
    checks.push('pi model/provider switch cannot show another account quota');
    await page.evaluate(() => window.__zmc.panel.dispose());
    assert.equal(await page.locator('.umeter').count(), 0);
    checks.push('unsupported backend and unknown usage are explicit; outside click and disposal work');
    assert.deepEqual(errors, []);
    writeFileSync(join(out, 'report.json'), JSON.stringify({ passed: true, checks, errors }, null, 2));
    console.log(JSON.stringify({ passed: true, checks }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
