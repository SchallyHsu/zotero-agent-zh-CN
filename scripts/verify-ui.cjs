// SPDX-License-Identifier: AGPL-3.0-or-later
// Added 2026-11-06; tests use synthetic preview data only.
const { chromium } = require('playwright');
const { resolve, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');

const root = resolve(__dirname, '..');
const out = join(root, 'test-output', 'screenshots');
mkdirSync(out, { recursive:true });
const url = pathToFileURL(join(root,'preview','dist','index.html')).href;
const report = {screens:[], checks:[], errors:[], untranslated:[]};

(async () => {
 const browser = await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
 const page = await browser.newPage({viewport:{width:540,height:920},deviceScaleFactor:1,locale:'zh-CN'});
 page.on('pageerror', e => report.errors.push(e.message));
 const shot = async name => {
  await page.screenshot({path:join(out,name+'.png')});
  const overflow = await page.evaluate(() => {
   const root=document.querySelector('#host').shadowRoot;
   return [...root.querySelectorAll('.vw__head,.status__top,.check__tx,.sec__head,.swrow__tx')].filter(el=>{
    const r=el.getBoundingClientRect(); return r.width>0 && (r.right>innerWidth+1 || r.left < -1);
   }).map(el=>el.className);
  });
  assert.deepEqual(overflow,[],name+' horizontal overflow');
  report.screens.push(name);
 };
 const load = async (query='') => { await page.goto(url+query); await page.getByRole('button',{name:'设置',exact:true}).waitFor(); };
 await load('?doctor=ok&ctx=item');
 await page.getByRole('heading',{name:'与文献库对话',exact:true}).waitFor();
 assert.equal(await page.locator('textarea').getAttribute('placeholder'),'输入问题，探索你的文献库…');
 await shot('01_对话主页');
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('heading',{name:'设置',exact:true}).waitFor();
 await page.getByText('推理强度',{exact:true}).waitFor();
 const before=await page.evaluate(()=>window.__zmc.host.getSettings());
 await shot('02_设置_模型与外观');
 await page.getByText('翻译',{exact:true}).scrollIntoViewIfNeeded();
 await shot('03_设置_翻译与技能');
 const after=await page.evaluate(()=>window.__zmc.host.getSettings());
 assert.deepEqual(after,before,'Opening/reading the Chinese settings must not change any stored setting');
 report.checks.push('Opening Chinese settings preserves all model, permission, credential-mode and prompt values');
 await page.getByRole('button',{name:'返回对话',exact:true}).click();
 await page.getByRole('button',{name:'历史对话',exact:true}).click();
 await page.getByRole('heading',{name:'历史对话',exact:true}).waitFor();
 await shot('04_历史记录');

 await load('?doctor=many&ctx=none');
 await page.locator('.stat').click();
 await page.getByRole('heading',{name:'运行状态',exact:true}).waitFor();
 await page.getByText(/\d+ 项需要处理/).waitFor();
 await shot('05_运行状态');
 report.untranslated=await page.evaluate(()=>{
  const sr=document.querySelector('#host').shadowRoot;
  return [...sr.querySelectorAll('.check__t,.check__d,.check__help,.status__sum,button')].filter(el=>el.getBoundingClientRect().width>0).map(el=>el.textContent.trim()).filter(t=>/[A-Za-z]{3}/.test(t)&&!/[\u3400-\u9fff]/.test(t)&&!/[\\/]|^Claude|^Codex|^pi$/.test(t));
 });

 // Exercise the actual observer after mount: text changes and attributes translate,
 // while user/assistant prose, paper titles, input values and permission IDs survive.
 const integrity=await page.evaluate(async()=>{
  const sr=document.querySelector('#host').shadowRoot;
  const box=document.createElement('div');
  for(const cls of ['ubub__text','md','hrow__t','source__t','pop__t','chip__t']){
   const el=document.createElement('div'); el.className=cls; el.textContent='History Settings Default ΔT = 25 K'; box.append(el);
  }
  const button=document.createElement('button'); button.textContent='Allow once'; button.dataset.optionId='allow_once'; button.title='Send (Ctrl+Enter)';
  button.onclick=()=>{window.__localePicked=button.dataset.optionId;}; box.append(button);
  const input=document.createElement('input'); input.value='History Settings Default'; input.placeholder='Search your library'; box.append(input);
  const dynamic=document.createElement('div');dynamic.textContent='3 things need attention';box.append(dynamic);
  sr.append(box);
  await new Promise(r=>setTimeout(r,80));
  button.click();
  const first=dynamic.textContent;
  dynamic.textContent='1 thing needs attention';
  await new Promise(r=>setTimeout(r,80));
  const result={protected:[...box.querySelectorAll('div')].slice(0,6).map(e=>e.textContent),button:button.textContent,title:button.title,permission:window.__localePicked,input:input.value,placeholder:input.placeholder,first,second:dynamic.textContent};
  box.remove();return result;
 });
 assert(integrity.protected.every(t=>t==='History Settings Default ΔT = 25 K'));
 assert.equal(integrity.button,'允许一次'); assert.equal(integrity.permission,'allow_once');
 assert.equal(integrity.input,'History Settings Default'); assert.equal(integrity.placeholder,'搜索文献库');
 assert.equal(integrity.title,'发送（Ctrl+Enter）');
 assert.equal(integrity.first,'3 项需要处理'); assert.equal(integrity.second,'1 项需要处理');
 report.checks.push('Conversation text, original paper titles, input values and permission IDs preserved; permission click still returns allow_once');
 report.checks.push('Dynamic status messages and accessible button attributes translated after mount');
 const streaming=await page.evaluate(async()=>{
  const root=document.querySelector('#host').shadowRoot;
  const md=document.createElement('div');md.className='md';root.append(md);
  md.innerHTML='<p title="Settings">History Settings Default</p><button title="Copy">Copy</button>';
  await new Promise(r=>setTimeout(r,20));
  const initial=md.querySelector('button').textContent;
  md.querySelector('p').firstChild.nodeValue='History Settings Default 2';
  md.querySelector('button').setAttribute('aria-label','History');
  const textarea=document.createElement('textarea');textarea.placeholder='Search your library';textarea.value='History Settings';root.append(textarea);
  const gone=document.createElement('button');gone.textContent='Settings';root.append(gone);gone.remove();
  await new Promise(r=>setTimeout(r,20));
  const result={initial,prose:md.querySelector('p').textContent,proseTitle:md.querySelector('p').title,control:md.querySelector('button').getAttribute('aria-label'),placeholder:textarea.placeholder,input:textarea.value,detached:gone.textContent};
  md.remove();textarea.remove();return result;
 });
 assert.deepEqual(streaming,{initial:'复制',prose:'History Settings Default 2',proseTitle:'Settings',control:'历史对话',placeholder:'搜索文献库',input:'History Settings',detached:'Settings'});
 report.checks.push('Streaming prose stays untouched; embedded copy controls and changed ARIA labels localize; detached nodes are skipped');
 await load('?theme=dark&doctor=ok&ctx=item');
 await page.getByRole('heading',{name:'与文献库对话',exact:true}).waitFor();
 await shot('06_深色主题');
 assert.deepEqual(report.errors,[],'Browser runtime errors');
 report.passed=true;
 await browser.close();
 writeFileSync(join(root,'test-output','ui-verification.json'),JSON.stringify(report,null,2),'utf8');
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{ report.passed=false;report.failure=e.stack;writeFileSync(join(root,'test-output','ui-verification.json'),JSON.stringify(report,null,2),'utf8');console.error(e);process.exit(1); });
