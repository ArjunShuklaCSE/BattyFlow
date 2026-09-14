import {_electron as electron} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const data=resolve('.local/failure-smoke');await mkdir(data,{recursive:true});
await writeFile(resolve(data,'settings.json'),await readFile('.local/capture-smoke/settings.json'));
const instance=await electron.launch({args:['.','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'],env:{...process.env,BATTYFLOW_DATA_DIR:data}});
const evidence={at:new Date().toISOString(),checks:[]};
try{
 await instance.firstWindow();let ui,capture;
 for(let i=0;i<100;i++){ui=instance.windows().find(w=>w.url()==='batty://app/index.html');capture=instance.windows().find(w=>w.url()==='batty://app/capture.html');if(ui&&capture)break;await new Promise(r=>setTimeout(r,100));}
 if(!ui||!capture)throw Error('WINDOWS_UNAVAILABLE');await ui.waitForSelector('#record');
 await capture.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('test denial','NotAllowedError');};});
 await ui.click('#record');await ui.waitForFunction(()=>document.querySelector('#state')?.textContent==='error');assert.equal(await ui.textContent('#notice'),'MICROPHONE_PERMISSION_DENIED');evidence.checks.push('Permission denial produces actionable error');
 assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('overlay=1')).isVisible()),true);evidence.checks.push('Microphone startup errors keep the overlay visible');
 await capture.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('test missing device','NotFoundError');};});await ui.waitForTimeout(350);await ui.click('#record');await ui.waitForFunction(()=>document.querySelector('#notice')?.textContent==='MICROPHONE_NOT_FOUND');evidence.checks.push('Missing/disconnected device startup recovers to actionable error');
 const boundary=await instance.evaluate(async({BrowserWindow,ipcMain})=>{
   const target=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='batty://app/index.html');
   // Integration probe from the trusted test process; it impersonates a wrong renderer role.
   const handle=ipcMain._invokeHandlers.get('capture:frame');
   try{await handle({sender:target.webContents,senderFrame:target.webContents.mainFrame},'fake',0,new Float32Array(320));return false;}catch{return true;}
 });assert.equal(boundary,true);evidence.checks.push('Wrong renderer role rejected at capture IPC');
 const network=await instance.evaluate(async()=>{try{await fetch('https://example.com');return false;}catch{return true;}});assert.equal(network,true);evidence.checks.push('Node fetch boundary rejects external network');
 await capture.reload();await capture.waitForFunction(()=>typeof window.capture==='object');await ui.waitForTimeout(350);await ui.click('#record');await ui.waitForFunction(()=>document.querySelector('#state')?.textContent==='recording');await ui.click('#cancel');assert.equal((await ui.evaluate(()=>window.batty.snapshot())).state,'cancelled');evidence.checks.push('Capture recovers after device/permission failures and can cancel');
 const capabilities=await ui.evaluate(async()=>(await window.batty.snapshot()).capabilities);assert.match(capabilities.insertion,/copy only/i);evidence.checks.push('External insertion remains copy-only');
}finally{await instance.close();await writeFile(resolve(data,'evidence.json'),JSON.stringify(evidence,null,2));}
console.log(JSON.stringify(evidence,null,2));
