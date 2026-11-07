const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, writeFileSync } = require('node:fs');
const root = resolve(__dirname, '..'), out = join(root, 'test-output');
mkdirSync(out, { recursive: true });
(async () => {
 const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
 let page;
 try {
  page = await browser.newPage({ viewport: { width: 420, height: 920 }, locale: 'zh-CN' });
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(join(root, 'preview/dist/index.html')).href + '?doctor=ok&ctx=item&speed=0&nohistory=1');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const choices = page.locator('.seg--agents');
  assert.equal(await choices.getByRole('radio').count(), 5);
  for (const [id, label, executable, reply] of [
   ['antigravity', 'Antigravity', 'C:\\Program Files\\Antigravity\\agy.exe', 'Antigravity fixture reply'],
   ['deepseek-harness', 'DeepSeek Harness', 'C:\\Agent Tools\\dsh.cmd', 'DeepSeek Harness fixture reply'],
  ]) {
   await choices.getByRole('radio', { name: label, exact: true }).click();
   const input = page.getByRole('textbox', { name: '助手程序路径', exact: true });
   await input.fill(executable); await input.press('Tab');
   await page.waitForFunction(({ id, executable }) => window.__zmc.host.getSettings().agentExecutables[id] === executable, { id, executable });
   await page.waitForTimeout(250);
   assert.equal(await input.inputValue(), executable);
   if (id === 'deepseek-harness') assert.equal(await page.getByRole('textbox', { name: /DeepSeek Harness API/ }).count(), 0);
   const overflow = await choices.evaluate(el => [...el.children].some(c => c.getBoundingClientRect().right > innerWidth));
   assert.equal(overflow, false);
   await choices.evaluate(el => el.scrollIntoView({ block: 'start' }));
   await page.screenshot({ path: join(out, `backend-${id}.png`) });
   await page.evaluate(id => { window.__zmc.sim.statuses.find(s => s.id === id).available = true; window.__zmc.sim.setSettingsElsewhere({ backend: id }); }, id);
   await page.getByRole('button', { name: '返回对话', exact: true }).click();
   await page.getByRole('button', { name: '新建对话', exact: true }).first().click();
   await page.evaluate(reply => { window.__zmc.sim.nextAnswer = reply; }, reply);
   const textarea = page.locator('textarea'); await textarea.fill(`${label} question`); await textarea.press('Enter');
   await page.getByText(reply, { exact: true }).waitFor();
   const sessions = await page.evaluate(() => window.__zmc.host.sessions());
   assert(sessions.some(s => s.backend === id && s.projectName === 'Zotero Agent' && s.paper?.itemKey));
   await page.getByRole('button', { name: '设置', exact: true }).click();
  }
  await page.evaluate(async () => {
   const host = window.__zmc.host;
   const s = (await host.sessions()).find(s => s.backend === 'deepseek-harness');
   await host.saveSession({ ...s, syncPending: true, syncError: '等待原生确认' });
   host.syncSession = async s => host.saveSession({ ...s, backendProjectId: 'native-fixture-project', syncPending: false, syncError: '' });
  });
  await page.getByRole('button', { name: '历史对话', exact: true }).click();
  await page.waitForFunction(async () => (await window.__zmc.host.sessions()).some(s => s.backend === 'deepseek-harness' && s.backendProjectId === 'native-fixture-project' && !s.syncPending));
  assert.equal(await page.getByRole('button', { name: '刷新原生项目归类状态' }).count(), 0);
  assert.deepEqual(errors, []);
  const report = { passed: true, checks: ['five selectable backends', 'custom executable paths with spaces', 'native credential setup hints', 'responsive agent chooser', 'Antigravity chat and paper metadata', 'DeepSeek Harness chat and paper metadata', 'independent backend session storage', 'pending project state clears after native acknowledgement'], errors };
  writeFileSync(join(out, 'backends-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
 } catch(e) { if(page) await page.screenshot({path: join(out,'backends-failure.png')}); throw e; }
 finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
