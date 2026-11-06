// SPDX-License-Identifier: AGPL-3.0-or-later
// Added 2026-11-06; synthetic localization-only benchmark.
const {chromium} = require('playwright');
const {buildSync} = require('esbuild');
const {readFileSync,writeFileSync,mkdirSync} = require('node:fs');
const {join} = require('node:path');
const assert = require('node:assert/strict');
const root=join(__dirname,'..');
const out=join(root,'test-output','performance'); mkdirSync(out,{recursive:true});
const bundle=buildSync({entryPoints:[join(root,'src/ui/localize.ts')],bundle:true,format:'iife',globalName:'LocaleProbe',write:false,target:'chrome120'}).outputFiles[0].text;

(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
 const report={note:'Synthetic local UI benchmark in headless Edge; not a measurement of AI/network latency or Zotero end-to-end responsiveness.',runs:[]};
 for(let run=0;run<3;run++) for(const variant of ['before','after']) {
  const page=await browser.newPage();
  await page.setContent('<div id="host"></div>');
  await page.evaluate(()=>{
   const Native=window.MutationObserver;
   window.__stats={calls:0,records:0,ms:0,maxMs:0,closest:0};
   const closest=Element.prototype.closest;
   Element.prototype.closest=function(...args){window.__stats.closest++;return closest.apply(this,args);};
   window.MutationObserver=class extends Native {
    constructor(callback){super((records,observer)=>{const t=performance.now();callback(records,observer);const dt=performance.now()-t;const s=window.__stats;s.calls++;s.records+=records.length;s.ms+=dt;s.maxMs=Math.max(s.maxMs,dt);});}
   };
  });
  await page.addScriptTag({content:variant==='before'?readFileSync(join(root,'test','fixtures','localize-0.15.2.1.js'),'utf8'):bundle});
  const result=await page.evaluate(async()=>{
   const root=document.querySelector('#host').attachShadow({mode:'open'});
   const stop=LocaleProbe.localizeRoot(root);
   const fixture=document.createElement('section');
   const md=document.createElement('div');md.className='md';fixture.append(md);root.append(fixture);
   const content=Array.from({length:400},(_,i)=>`<p><strong>History Settings Default ${i}</strong> Self-heating and device reliability <em>ΔT = 25 K</em>.</p>`).join('');
   for(let i=0;i<50;i++){
    md.innerHTML=content+`<button title="Copy">Copy</button><p>Streaming ${i}</p>`;
    fixture.setAttribute('aria-label',i%2?'History':'Settings');
    await new Promise(r=>setTimeout(r,0));
   }
   const button=md.querySelector('button');
   const integrity={copy:button.textContent,title:button.title,prose:md.querySelector('strong').textContent,attribute:fixture.getAttribute('aria-label')};
   const stats={...window.__stats};stop();root.innerHTML='';return {stats,integrity};
  });
  assert.deepEqual(result.integrity,{copy:'复制',title:'复制',prose:'History Settings Default 0',attribute:'历史对话'});
  report.runs.push({variant,run,...result.stats});await page.close();
 }
 const median=xs=>xs.sort((a,b)=>a-b)[Math.floor(xs.length/2)];
 report.median=Object.fromEntries(['before','after'].map(v=>[v,Object.fromEntries(['calls','records','ms','maxMs','closest'].map(k=>[k,median(report.runs.filter(r=>r.variant===v).map(r=>r[k]))]))]));
 writeFileSync(join(out,'comparison.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report.median,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
