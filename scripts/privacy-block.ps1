param([Parameter(Mandatory=$true)][string[]]$Programs, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$group = 'BattyFlow local-only validation'
$admin = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Run this specific script in an Administrator PowerShell. It only manages the BattyFlow validation rule group.' }
if ($Remove) { Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue | Remove-NetFirewallRule; return }
if (@(Get-NetFirewallProfile | Where-Object { -not $_.Enabled }).Count -gt 0) { throw 'Firewall profiles must be enabled before this can establish a blocking boundary. This script does not change global firewall settings.' }
foreach ($program in $Programs) {
  $resolved = (Resolve-Path -LiteralPath $program).Path
  if ([IO.Path]::GetExtension($resolved) -ne '.exe' -or $resolved.StartsWith('\\')) { throw 'Select a local executable file.' }
  New-NetFirewallRule -DisplayName ('BattyFlow block: ' + [IO.Path]::GetFileName($resolved)) -Group $group -Direction Outbound -Action Block -Program $resolved -Profile Any -Enabled True | Out-Null
}
Write-Output 'Program-scoped outbound block installed. Run the capture and benchmark checks, then use -Remove with the same Programs argument.'
