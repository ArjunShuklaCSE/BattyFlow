import { _electron as electron } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const dataDir = resolve('.local/desktop-smoke',randomUUID()); await mkdir(dataDir,{recursive:true});
const instance = await electron.launch({ args:['.'], env:{...process.env,BATTYFLOW_DATA_DIR:dataDir}, timeout:30000 });
const evidence = { at:new Date().toISOString(),checks:[],errors:[] };
try {
  await instance.firstWindow();
  const deadline=Date.now()+20000;let page;
  while(Date.now()<deadline){page=instance.windows().find(w=>w.url()==='batty://app/index.html');if(page)break;await new Promise(r=>setTimeout(r,100));}
  if(!page)throw Error('Settings window unavailable'); await page.waitForSelector('#record');
  page.on('pageerror',error=>evidence.errors.push(error.message));
  assert.match(await page.title(),/BattyFlow/); evidence.checks.push('Electron launches; UI preload responds');
  assert.equal(await page.locator('#setup-required').isVisible(),true);
  await page.click('#record'); await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='error');
  assert.match(await page.textContent('#notice'),/Speech setup is incomplete/); evidence.checks.push('Fresh installation explains missing speech setup before microphone capture');
  const overlay = instance.windows().find(w=>w.url().includes('overlay=1'));assert.ok(overlay);
  const overlayState = await instance.evaluate(({BrowserWindow,screen})=>{
    const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('overlay=1'));
    return {visible:w.isVisible(),focusable:w.isFocusable(),focused:w.isFocused(),bounds:w.getBounds(),work:screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea};
  });
  assert.equal(overlayState.visible,true);assert.equal(overlayState.focusable,false);assert.equal(overlayState.focused,false);
  assert.ok(overlayState.bounds.x>=overlayState.work.x && overlayState.bounds.y>=overlayState.work.y);
  assert.ok(overlayState.bounds.y+overlayState.bounds.height<=overlayState.work.y+overlayState.work.height);
  assert.match(await overlay.textContent('#overlay-notice'),/Speech setup is incomplete/);
  evidence.checks.push('Startup failure shows non-activating overlay on the current monitor');
  await overlay.click('#overlay-dismiss');
  assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('overlay=1')).isVisible()),false);
  evidence.checks.push('Failed session overlay can be dismissed');
  await page.click('#setup-models');assert.equal(await page.locator('#models').isVisible(),true);
  // Substitute only the native picker selection; exercise the real import/validation/persistence IPC.
  for(const [kind,title] of [['whisper','Whisper runtime'],['asrModel','Speech recognition model']]){
    await instance.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},resolve(`.local/manifests/${kind}.json`));
    await page.locator('.asset').filter({has:page.getByRole('heading',{name:title,exact:true})}).getByRole('button').click();
    await page.waitForFunction(async key=>!!(await window.batty.snapshot()).settings[key],kind);
  }
  await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('Ready to record locally'));
  await page.click('[data-page="studio"]');assert.equal(await page.locator('#setup-required').isVisible(),false);
  evidence.checks.push('Importing verified runtime and model clears setup error and persists readiness');
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
