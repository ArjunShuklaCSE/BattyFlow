import {_electron as electron} from 'playwright';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const data=resolve('.local/target-smoke');await mkdir(data,{recursive:true});
const instance=await electron.launch({args:['.','--force-renderer-accessibility'],env:{...process.env,BATTYFLOW_DATA_DIR:data}});
const evidence={at:new Date().toISOString(),checks:[]};
const probe=()=>{const r=spawnSync(resolve('dist/native/TargetProbe.exe'),['selection'],{encoding:'utf8',windowsHide:true,timeout:5000});if(r.status!==0)throw Error('PROBE_FAILED');return JSON.parse(r.stdout);};
try{
 await instance.firstWindow();let page;for(let i=0;i<100;i++){page=instance.windows().find(w=>w.url()==='batty://app/index.html');if(page)break;await new Promise(r=>setTimeout(r,100));}if(!page)throw Error('UI_MISSING');await page.waitForSelector('#test-field');
 await page.fill('#test-field','alpha selected phrase omega');await page.focus('#test-field');
 await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='batty://app/index.html').focus());
 await page.evaluate(()=>{const e=document.querySelector('#test-field');e.focus();e.setSelectionRange(6,21);});await page.waitForTimeout(500);
 const selected=probe();evidence.selection=selected;assert.equal(selected.selection,'selected phrase');assert.equal(selected.secure,false);evidence.checks.push('Native UI Automation reads only the selected range in controlled Chromium textarea');
 await page.evaluate(()=>{const e=document.querySelector('#test-field');e.setSelectionRange(0,0);});await page.waitForTimeout(200);const empty=probe();assert.equal(empty.selection,undefined);evidence.checks.push('Empty selection produces no selected text');
 await page.evaluate(()=>{const e=document.createElement('input');e.type='password';e.id='test-password';e.value='synthetic-secret';document.body.append(e);e.focus();e.select();});await page.waitForTimeout(200);const password=probe();assert.equal(password.selection,undefined);assert.equal(password.secure,true);evidence.checks.push('Password field is detected; selection is never exposed');
}catch(error){evidence.failure=String(error);throw error;}
finally{await instance.close();await writeFile(resolve(data,'evidence.json'),JSON.stringify(evidence,null,2));}
console.log(JSON.stringify(evidence,null,2));
