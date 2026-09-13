import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const dataDir = resolve('.local/desktop-smoke'); await mkdir(dataDir,{recursive:true});
const instance = await electron.launch({ args:['.'], env:{...process.env,BATTYFLOW_DATA_DIR:dataDir}, timeout:30000 });
const evidence = { at:new Date().toISOString(),checks:[],errors:[] };
try {
  await instance.firstWindow();
  const deadline=Date.now()+20000;let page;
  while(Date.now()<deadline){page=instance.windows().find(w=>w.url()==='batty://app/index.html');if(page)break;await new Promise(r=>setTimeout(r,100));}
  if(!page)throw Error('Settings window unavailable'); await page.waitForSelector('#record');
  page.on('pageerror',error=>evidence.errors.push(error.message));
  assert.match(await page.title(),/BattyFlow/); evidence.checks.push('Electron launches; UI preload responds');
  await page.click('#record'); await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='error');
  assert.match(await page.textContent('#notice'),/Import a Whisper/); evidence.checks.push('Missing model fails visibly before microphone capture');
  const isolated = await page.evaluate(()=>({require:typeof globalThis.require,process:typeof globalThis.process,bridgeKeys:Object.keys(window.batty)}));
  assert.equal(isolated.require,'undefined');assert.equal(isolated.process,'undefined');evidence.checks.push('UI has no Node or arbitrary IPC primitive');
  const blocked = await page.evaluate(async()=>{try{await fetch('https://example.com');return false;}catch{return true;}});assert.equal(blocked,true);evidence.checks.push('Renderer external fetch blocked');
  await page.click('[data-page="preferences"]'); await page.click('#refresh-devices');
  await page.waitForTimeout(500); evidence.microphoneChoices = await page.locator('#microphone option').allTextContents();
  await page.click('[data-page="vocabulary"]');await page.waitForFunction(()=>document.querySelector('#dictionary')?.value.includes('OAuth'));evidence.checks.push('Dictionary IPC and settings navigation work');
  await page.click('[data-page="studio"]');
  await page.screenshot({path:resolve('.local/desktop-smoke.png'),fullPage:true});
  evidence.runtime=await instance.evaluate(({app})=>({electron:process.versions.electron,platform:process.platform,packaged:app.isPackaged}));
  evidence.windows=await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({url:w.webContents.getURL(),visible:w.isVisible(),focusable:w.isFocusable(),preferences:w.webContents.getLastWebPreferences()})));
  assert.equal(evidence.errors.length,0);
} finally { await instance.close(); evidence.checks.push('Electron quit completes'); await writeFile(resolve('.local/desktop-smoke.json'),JSON.stringify(evidence,null,2)); }
console.log(JSON.stringify(evidence,null,2));
