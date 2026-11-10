// Synthetic settings only; never contacts the configured URL or a model.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, writeFileSync } = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(join(__dirname, '../preview/dist/index.html')).href + '?doctor=ok&speed=0&nohistory=1');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.waitForTimeout(400);
    const card = page.locator('[data-chat-sync]');
    await card.scrollIntoViewIfNeeded();
    assert.equal(await card.getByRole('switch').isChecked(), false);
    await card.getByRole('textbox', { name: 'WebDAV 目录地址', exact: true }).fill('https://example.com/dav/');
    await card.getByRole('textbox', { name: 'WebDAV 用户名', exact: true }).fill('reader');
    await card.getByLabel('WebDAV 密码', { exact: true }).fill('synthetic-password');
    assert.equal(await card.getByLabel('WebDAV 密码', { exact: true }).getAttribute('type'), 'password');
    await card.getByRole('switch').check();
    await card.getByRole('button', { name: '保存并同步', exact: true }).click();
    await page.waitForFunction(() => window.__zmc.host.getSettings().chatSync?.enabled);
    assert.equal(await page.evaluate(() => JSON.stringify(window.__zmc.host.getSettings()).includes('synthetic-password')), false);
    await card.getByText('聊天已同步', { exact: true }).waitFor();
    const out = join(__dirname, '../test-output'); mkdirSync(out, { recursive: true });
    await page.screenshot({ path: join(out, 'chat-sync-settings.png') });
    await page.evaluate(() => window.__zmc.sim.setSettingsElsewhere({ appearance: { ...window.__zmc.host.getSettings().appearance, language: 'en' } }));
    await card.getByRole('button', { name: 'Save and sync', exact: true }).waitFor();
    await page.screenshot({ path: join(out, 'chat-sync-settings-en.png') });
    assert.deepEqual(errors, []);
    writeFileSync(join(out, 'chat-sync-ui-report.json'), JSON.stringify({ passed: true, checks: ['off by default', 'Chinese and English settings', 'masked password', 'credentials excluded from prefs', 'saved settings', 'no browser errors'] }, null, 2));
    console.log('Chat sync settings: passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
