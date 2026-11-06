// SPDX-License-Identifier: AGPL-3.0-or-later
// Added 2026-11-06: expand upstream test paths without shell-dependent globbing.
import {readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const files=[];
function collect(dir){
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory()) collect(path);
    else if(entry.name.endsWith('.test.ts')) files.push(path);
  }
}
collect(join(root,'test'));
if(!files.length) throw new Error('No upstream unit tests found');
const result=spawnSync(process.execPath,['--test','--test-reporter=dot',...files.sort()],{cwd:root,stdio:'inherit'});
if(result.error) throw result.error;
process.exitCode=result.status??1;
