import { _electron as electron } from 'playwright';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const physical=process.argv.includes('--physical');const packaged=process.argv.includes('--packaged');
const dataDir=resolve(`.local/${packaged?'packaged-':''}${physical?'physical':'capture'}-smoke`);await mkdir(dataDir,{recursive:true});
const settings={schemaVersion:1,microphone:'',language:'en',profile:'neutral',mode:'dictation',shortcut:'CommandOrControl+Alt+D',commandShortcut:'CommandOrControl+Alt+J',editShortcut:'CommandOrControl+Alt+E',maxSeconds:30,silenceStop:false,rawFallback:false,preview:false,context:false,threads:4,targetLanguage:'es',translationPairs:[],whisper:JSON.parse(await readFile('.local/manifests/whisper.json','utf8')),asrModel:JSON.parse(await readFile('.local/manifests/asrModel.json','utf8'))};
await writeFile(resolve(dataDir,'settings.json'),JSON.stringify(settings));
const args=packaged?[]:['.'];if(!physical)args.push('--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${resolve('benchmark/fixtures/generated/plain.wav')}%noloop`);
const instance=await electron.launch({...(packaged?{executablePath:resolve('release/win-unpacked/BattyFlow.exe')}:{}),args,env:{...process.env,BATTYFLOW_DATA_DIR:dataDir},timeout:30000});
const evidence={at:new Date().toISOString(),kind:physical?'Physical microphone; capture and cancellation only; no content recorded in evidence':'Synthetic WAV through Chromium getUserMedia and AudioWorklet into real Whisper CPU CLI',packaged,checks:[],errors:[]};
try{
  await instance.firstWindow();let page;for(let i=0;i<100;i++){page=instance.windows().find(w=>w.url()==='batty://app/index.html');if(page)break;await new Promise(r=>setTimeout(r,100));}if(!page)throw Error('UI missing');
  await page.waitForSelector('#record');page.on('pageerror',e=>evidence.errors.push(e.message));
  await page.click('#record');await page.waitForFunction(()=>['recording','error'].includes(document.querySelector('#state')?.textContent));
  const state=await page.textContent('#state');if(state==='error')throw Error(await page.textContent('#notice'));
  evidence.checks.push('Microphone opens; AudioWorklet starts');await page.waitForTimeout(physical?1200:4500);
  evidence.beforeStop=await page.evaluate(async()=>{const v=await window.batty.snapshot();return{state:v.state,elapsed:v.elapsed,timings:v.timings};});assert.ok(evidence.beforeStop.elapsed>0);evidence.checks.push('Bounded 16 kHz PCM frames arrive');
  if(physical){await page.click('#cancel');await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='cancelled');evidence.checks.push('Physical capture cancels without transcription');}
  else{
    await page.click('#record');await page.waitForFunction(()=>['ready','error'].includes(document.querySelector('#state')?.textContent),null,{timeout:100000});
    const result=await page.evaluate(()=>window.batty.snapshot());evidence.result=result.text;evidence.timings=result.timings;evidence.notice=result.notice;
    assert.equal(result.state,'ready');assert.match(result.text,/review/i);evidence.checks.push('Real local ASR returns the synthetic spoken sentence');
    await page.fill('#test-field','prefix ');await page.click('#test-field');await page.press('#test-field','End');await page.click('#insert-test');assert.match(await page.inputValue('#test-field'),/^prefix .*review/i);evidence.checks.push('Single in-app insertion preserves existing text');
    await page.waitForTimeout(400);await page.click('#record');await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='recording');await page.click('#cancel');await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='cancelled');
    await page.waitForTimeout(500);assert.equal((await page.evaluate(()=>window.batty.snapshot())).text,'');evidence.checks.push('Cancellation clears result and rejects late frames');
  }
  evidence.shortcutRegistered=await instance.evaluate(({globalShortcut})=>globalShortcut.isRegistered('CommandOrControl+Alt+D'));
  assert.equal(evidence.shortcutRegistered,true);evidence.checks.push('Global toggle registered');
  await page.screenshot({path:resolve(`.local/${packaged?'packaged-':''}capture-smoke.png`),fullPage:true});
  assert.equal(evidence.errors.length,0);
}catch(error){evidence.failure=String(error);throw error;}
finally{await instance.close();evidence.checks.push('Quit releases capture and inference');await writeFile(resolve(dataDir,'evidence.json'),JSON.stringify(evidence,null,2));}
console.log(JSON.stringify(evidence,null,2));
