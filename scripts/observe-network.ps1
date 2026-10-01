# Samples TCP/UDP activity of BattyFlow and its inference processes while you use the app.
# This is a sampled observation, not packet capture or proof of zero egress; short-lived connections can be
# missed. For a hard guarantee, block the programs with scripts/privacy-block.ps1 (see docs/privacy.md).
param([int]$Seconds = 30)
$ErrorActionPreference = 'Stop'
$names = @('BattyFlow.exe', 'electron.exe', 'BattyHelper.exe', 'whisper-cli.exe', 'llama-cli.exe')
$seen = @{}; $samples = 0; $external = 0; $loopback = 0; $udp = 0
$until = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $until) {
  $processes = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in $names })
  $ids = @($processes | ForEach-Object { $_.ProcessId })
  foreach ($proc in $processes) { $seen[[string]$proc.ProcessId] = $proc.Name }
  if ($ids.Count -gt 0) {
    $connections = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in $ids -and $_.State -eq 'Established' })
    $external += @($connections | Where-Object { $_.RemoteAddress -notin @('127.0.0.1', '::1', '::ffff:127.0.0.1') }).Count
    $loopback += @($connections | Where-Object { $_.RemoteAddress -in @('127.0.0.1', '::1', '::ffff:127.0.0.1') }).Count
    $udp += @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in $ids }).Count
  }
  $samples++; Start-Sleep -Milliseconds 100
}
[ordered]@{
  at = (Get-Date).ToUniversalTime().ToString('o')
  samples = $samples
  processes = $seen
  externalTcpSamples = $external
  loopbackTcpSamples = $loopback
  udpEndpointSamples = $udp
} | ConvertTo-Json -Depth 4
