import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
// The helper is built with the C# compiler that ships with Windows (.NET Framework 4.x), so building
// BattyFlow needs no Visual Studio or .NET SDK.
if (process.platform === 'win32') {
  await mkdir('dist/native', { recursive: true });
  await rm('dist/native/TargetProbe.exe', { force: true });
  const windows = process.env.SystemRoot ?? 'C:\\Windows';
  const framework = join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const wpf = join(framework, 'WPF');
  const result = spawnSync(
    join(framework, 'csc.exe'),
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/optimize+',
      `/out:${resolve('dist/native/BattyHelper.exe')}`,
      `/reference:${join(wpf, 'UIAutomationClient.dll')}`,
      `/reference:${join(wpf, 'UIAutomationTypes.dll')}`,
      `/reference:${join(wpf, 'WindowsBase.dll')}`,
      `/reference:${join(framework, 'System.Web.Extensions.dll')}`,
      `/reference:${join(framework, 'System.Windows.Forms.dll')}`,
      resolve('native/windows/BattyHelper.cs'),
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.status !== 0) throw Error(`Native helper build failed: ${result.stdout}${result.stderr}`);
}
