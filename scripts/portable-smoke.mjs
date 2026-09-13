import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import assert from 'node:assert/strict';
async function port(){const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value;}
const chromePort=await port(),nodePort=await port();
const data=resolve('.local/portable-cdp');await mkdir(data,{recursive:true});await writeFile(join(data,'settings.json'),await readFile('.local/capture-smoke/settings.json'));
const processHandle=spawn(resolve('release/BattyFlow 0.1.0.exe'),[`--remote-debugging-port=${chromePort}`,`--inspect=127.0.0.1:${nodePort}`,'--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${resolve('benchmark/fixtures/generated/plain.wav')}%noloop`],{windowsHide:true,stdio:'ignore',env:{...process.env,BATTYFLOW_DATA_DIR:data}});
const evidence={at:new Date().toISOString(),checks:[],method:'Portable self-extracting launcher; explicit loopback debugging ports for test only. Normal app launch has no debugging arguments.'};
let browser,ws;
async function inspect(expression){const id=Math.floor(Math.random()*1000000);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('INSPECTOR_TIMEOUT')),5000);const listener=event=>{const reply=JSON.parse(event.data);if(reply.id===id){clearTimeout(timer);ws.removeEventListener('message',listener);resolve(reply.result);}};ws.addEventListener('message',listener);ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,returnByValue:true,awaitPromise:true}}));});}
try{
 let online=false;for(let i=0;i<150;i++){try{const response=await fetch(`http://127.0.0.1:${chromePort}/json/version`);if(response.ok){online=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}if(!online)throw Error('PORTABLE_CHROMIUM_NOT_READY');
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${chromePort}`);let page;
 for(let i=0;i<100;i++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='batty://app/index.html');if(page)break;await new Promise(r=>setTimeout(r,100));}if(!page)throw Error('PORTABLE_UI_MISSING');
 await page.waitForSelector('#record');evidence.checks.push('Portable launcher extracts and opens actual app UI');
 const targets=await(await fetch(`http://127.0.0.1:${nodePort}/json/list`)).json();ws=new WebSocket(targets[0].webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await page.click('#record');await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='recording');await page.waitForTimeout(4500);await page.click('#record');await page.waitForFunction(()=>['ready','error'].includes(document.querySelector('#state')?.textContent),null,{timeout:100000});
 const result=await page.evaluate(()=>window.batty.snapshot());assert.equal(result.state,'ready');assert.match(result.text,/review/i);evidence.result=result.text;evidence.timings=result.timings;evidence.checks.push('Portable artifact performs real local ASR through the microphone pipeline');
 await page.fill('#test-field','prefix ');await page.click('#test-field');await page.press('#test-field','End');await page.click('#insert-test');assert.match(await page.inputValue('#test-field'),/^prefix .*review/i);evidence.checks.push('In-app insertion preserves existing text');
 await page.waitForTimeout(350);await page.click('#record');await page.waitForFunction(()=>document.querySelector('#state')?.textContent==='recording');await page.click('#cancel');assert.equal((await page.evaluate(()=>window.batty.snapshot())).text,'');evidence.checks.push('Cancellation prevents late result delivery');
 await page.screenshot({path:resolve('.local/portable-cdp.png'),fullPage:true});
 const runtime=await inspect("JSON.stringify({electron:process.versions.electron,nativeHelperPresent:process.getBuiltinModule('fs').existsSync(process.resourcesPath+'/app.asar.unpacked/dist/native/TargetProbe.exe')})");evidence.runtime=runtime.result.value;
 const icon=await inspect("(()=>{const e=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron');const i=e.nativeImage.createFromPath(process.resourcesPath+'/app.asar/dist/icon.png');return JSON.stringify({empty:i.isEmpty(),size:i.getSize(),visiblePixels:[...i.toBitmap()].filter((x,n)=>n%4===3&&x>0).length});})()");evidence.trayIcon=JSON.parse(icon.result.value);assert.equal(evidence.trayIcon.empty,false);assert.ok(evidence.trayIcon.visiblePixels>0);evidence.checks.push('Packaged tray asset is nonempty and has visible pixels');
 const quit=await inspect("process.getBuiltinModule('module').createRequire(process.resourcesPath + '/app.asar/package.json')('electron').app.quit()").catch(()=>null);if(quit?.exceptionDetails)throw Error('APP_QUIT_INSPECTOR_FAILED');
 ws.close();ws=null;await browser.close().catch(()=>{});browser=null;
 const exited=await Promise.race([new Promise(r=>{if(processHandle.exitCode!==null)r(true);else processHandle.once('exit',()=>r(true));}),new Promise(r=>setTimeout(()=>r(false),15000))]);assert.equal(exited,true);evidence.checks.push('Clean app quit returns from portable launcher after test debugger detaches');
}catch(error){evidence.failure=String(error);throw error;}
finally{
 ws?.close();await browser?.close().catch(()=>{});
 if(processHandle.exitCode===null)spawn(join(process.env.SystemRoot??'C:\\Windows','System32/taskkill.exe'),['/PID',String(processHandle.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
 await writeFile(join(data,'evidence.json'),JSON.stringify(evidence,null,2));
}
console.log(JSON.stringify(evidence,null,2));
