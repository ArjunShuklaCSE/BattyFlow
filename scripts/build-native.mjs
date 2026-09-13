import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
if(process.platform==='win32'){
 await mkdir('dist/native',{recursive:true});
 const windows=process.env.SystemRoot??'C:\\Windows';const framework=join(windows,'Microsoft.NET','Framework64','v4.0.30319');
 const wpf=join(framework,'WPF');
 const result=spawnSync(join(framework,'csc.exe'),['/nologo','/target:exe','/platform:x64',`/out:${resolve('dist/native/TargetProbe.exe')}`,`/reference:${join(wpf,'UIAutomationClient.dll')}`,`/reference:${join(wpf,'UIAutomationTypes.dll')}`,`/reference:${join(wpf,'WindowsBase.dll')}`,`/reference:${join(framework,'System.Web.Extensions.dll')}`,resolve('native/windows/TargetProbe.cs')],{encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw Error(`Native target adapter build failed: ${result.stdout}${result.stderr}`);
}
