// Synthetic UI workflow: no library, model, credentials or user's session files are accessed.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, writeFileSync } = require('node:fs');
const root = resolve(__dirname, '..');
const out = join(root, 'test-output');
mkdirSync(out, { recursive: true });
(async () => {
 const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
 let page;
 try {
  page = await browser.newPage({ viewport: { width: 420, height: 900 }, locale: 'zh-CN' });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(join(root, 'preview/dist/index.html')).href + '?doctor=ok&ctx=item&speed=0&nohistory=1');
  const draft = page.locator('textarea');
  await draft.waitFor();
  await page.waitForTimeout(150);
  await page.evaluate(() => { window.__zmc.sim.nextAnswer = 'Article A response'; });
  await draft.fill('Article A first question'); await draft.press('Enter');
  await page.getByText('Article A response', { exact: true }).waitFor();
  await page.waitForFunction(() => window.__zmc.sim.writes.some(x => x.ev.t === 'turn_end'));
  let all = await page.evaluate(() => window.__zmc.host.sessions());
  const a1 = all[0];
  assert.equal(a1.projectName, 'Zotero Agent'); assert(a1.paper.itemKey);
  assert(a1.cwd.endsWith('/Zotero Agent'));

  await page.getByRole('button', { name: '历史对话', exact: true }).click();
  await page.getByRole('button', { name: '重命名 Article A first question', exact: true }).click();
  await page.getByRole('textbox', { name: '对话名称', exact: true }).fill('重命名后的文章 A 对话');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('重命名后的文章 A 对话', { exact: true }).waitFor();
  await page.screenshot({ path: join(out, 'conversations-history.png') });
  await page.getByRole('button', { name: '返回对话', exact: true }).click();
  await page.evaluate(() => { window.__zmc.sim.nextAnswer = 'A continued'; });
  await draft.fill('Continue A'); await draft.press('Enter');
  await page.getByText('A continued', { exact: true }).waitFor();
  all = await page.evaluate(() => window.__zmc.host.sessions());
  assert.equal(all.find(s => s.id === a1.id).title, '重命名后的文章 A 对话');

  await draft.fill('Unsent A draft');
  await page.evaluate(() => window.__zmc.sim.setContext('area'));
  await page.waitForFunction(() => document.querySelector('#host').shadowRoot.querySelector('textarea').value === '');
  await page.evaluate(() => { window.__zmc.sim.nextAnswer = 'Article B response'; });
  await draft.fill('Article B first question'); await draft.press('Enter');
  await page.getByText('Article B response', { exact: true }).waitFor();
  const b = (await page.evaluate(() => window.__zmc.host.sessions())).find(s => s.id !== a1.id);
  assert.notEqual(b.paper.itemKey, a1.paper.itemKey);
  await page.evaluate(() => window.__zmc.sim.setContext('item'));
  await page.getByText('A continued', { exact: true }).waitFor();
  assert.equal(await draft.inputValue(), 'Unsent A draft');

  // Explicit new chat must stay new for the same article, then be restored on the next visit.
  await page.getByRole('button', { name: '新建对话', exact: true }).first().click();
  await page.waitForFunction(() => !document.querySelector('#host').shadowRoot.textContent.includes('A continued'));
  await page.evaluate(() => { window.__zmc.sim.nextAnswer = 'Second A response'; });
  await draft.fill('Second A conversation'); await draft.press('Enter');
  await page.getByText('Second A response', { exact: true }).waitFor();
  await page.evaluate(() => window.__zmc.sim.setContext('area'));
  await page.getByText('Article B response', { exact: true }).waitFor();
  await page.evaluate(() => window.__zmc.sim.setContext('item'));
  await page.getByText('Second A response', { exact: true }).waitFor();
  // A→B→A during the asynchronous lookup must not land on B.
  await page.evaluate(() => { window.__zmc.sim.setContext('area'); window.__zmc.sim.setContext('item'); });
  await page.waitForTimeout(200);
  assert.equal(await page.getByText('Second A response', { exact: true }).count(), 1);

  // A focus change waits for a running answer; it must not cancel or mix article sessions.
  await page.evaluate(() => { window.__zmc.sim.speed = 12; window.__zmc.sim.nextAnswer = 'Streaming reply completes before switching articles.'; });
  await draft.fill('Continue the second conversation'); await draft.press('Enter');
  await page.waitForFunction(() => window.__zmc.sim.prompts.some(p => p.text.includes('Continue the second conversation')));
  await page.evaluate(() => window.__zmc.sim.setContext('area'));
  await page.getByText('Article B response', { exact: true }).waitFor();
  all = await page.evaluate(() => window.__zmc.host.sessions());
  const second = all.find(s => s.title === 'Second A conversation');
  const completed = await page.evaluate(id => window.__zmc.host.loadEvents(id), second.id);
  assert.equal(completed.filter(e => e.t === 'turn_end').at(-1).stop, 'end_turn');
  assert(completed.filter(e => e.t === 'text').map(e => e.delta).join('').includes('Streaming reply completes'));
  await page.evaluate(() => { window.__zmc.sim.speed = 0; window.__zmc.sim.setContext('item'); });
  await page.getByText('Streaming reply completes before switching articles.', { exact: true }).waitFor();

  // Opening an older conversation makes that one the article's last-opened conversation.
  await page.getByRole('button', { name: '历史对话', exact: true }).click();
  await page.getByRole('button').filter({ has: page.getByText('重命名后的文章 A 对话', { exact: true }) }).click();
  await page.getByText('A continued', { exact: true }).waitFor();
  await page.evaluate(() => window.__zmc.sim.setContext('area'));
  await page.getByText('Article B response', { exact: true }).waitFor();
  await page.evaluate(() => window.__zmc.sim.setContext('item'));
  await page.getByText('A continued', { exact: true }).waitFor();

  // Turning off automatic restore keeps the current chat when the article changes.
  await page.evaluate(() => window.__zmc.sim.setSettingsElsewhere({ autoResumePaper: false }));
  await page.evaluate(() => window.__zmc.sim.setContext('area'));
  await page.waitForTimeout(100);
  assert.equal(await page.getByText('A continued', { exact: true }).count(), 1);
  await page.evaluate(() => window.__zmc.sim.setSettingsElsewhere({ autoResumePaper: true }));
  await page.getByText('Article B response', { exact: true }).waitFor();

  await page.getByRole('button', { name: '历史对话', exact: true }).click();
  await page.getByRole('combobox', { name: '对话分组方式' }).selectOption('paper');
  await page.getByRole('searchbox', { name: '搜索历史对话' }).fill('Zotero Agent');
  assert.equal(await page.locator('.hrow__main').count(), 3);
  await page.screenshot({ path: join(out, 'conversations-history.png') });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const project = page.getByRole('textbox', { name: '项目名称', exact: true });
  assert.equal(await project.inputValue(), 'Zotero Agent');
  await project.fill('我的科研项目'); await project.press('Tab');
  await page.waitForFunction(() => window.__zmc.host.getSettings().projectName === '我的科研项目');
  await page.waitForTimeout(300); // late health/catalog renders preserve the settings scroll position
  await page.getByText('项目与对话', { exact: true }).evaluate(el => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(50);
  await page.screenshot({ path: join(out, 'conversations-settings.png') });
  assert.deepEqual(errors, []);
  const report = { passed: true, checks: ['project defaults and settings', 'rename persists across subsequent turns', 'article A/B isolation and automatic restore', 'draft preservation', 'multiple conversations per article', 'rapid focus changes', 'running replies finish before switching', 'last opened conversation takes precedence', 'automatic restore can be disabled', 'history grouping and search'], errors };
  writeFileSync(join(out, 'conversations-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
 } catch (e) {
  if (page) {
   await page.screenshot({ path: join(out, 'conversations-failure.png') });
   writeFileSync(join(out, 'conversations-failure.json'), JSON.stringify(await page.evaluate(async () => ({ sessions: await window.__zmc.host.sessions(), text: window.__zmc.shadow.querySelector('.chat').textContent, errors: window.__zmc.sim.writes.filter(e => e.ev.t === 'notice') })), null, 2));
  }
  throw e;
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
