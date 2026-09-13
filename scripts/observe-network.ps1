param([int]$Seconds=15)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$programs = @(
  (Join-Path $repository 'node_modules\electron\dist\electron.exe'),
  (Join-Path $repository 'release\win-unpacked\BattyFlow.exe'),
  (Join-Path $repository '.local\runtime\whisper-1.8.3\Release\whisper-cli.exe'),
  (Join-Path $repository '.local\runtime\llama-b6532\llama-cli.exe')
)
$seen = @{}; $samples = 0; $external = 0; $loopback = 0; $udp = 0
$until = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $until) {
  $processes = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -in $programs })
  $ids = @($processes | ForEach-Object { $_.ProcessId })
  foreach ($proc in $processes) { $seen[[string]$proc.ProcessId] = $proc.Name }
  if ($ids.Count -gt 0) {
    $connections = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in $ids -and $_.State -eq 'Established' })
    $external += @($connections | Where-Object { $_.RemoteAddress -notin @('127.0.0.1','::1','::ffff:127.0.0.1') }).Count
    $loopback += @($connections | Where-Object { $_.RemoteAddress -in @('127.0.0.1','::1','::ffff:127.0.0.1') }).Count
    $udp += @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in $ids }).Count
  }
  $samples++; Start-Sleep -Milliseconds 100
}
$report = @{ at=(Get-Date).ToUniversalTime().ToString('o'); sampleCount=$samples; processes=$seen; externalEstablishedTcpSamples=$external; loopbackEstablishedTcpSamples=$loopback; udpEndpointSamples=$udp; limitation='Sampled observation, not packet capture or proof of zero egress. Short-lived connections may be missed; UDP endpoints do not identify remote traffic. Playwright uses loopback debugging in the test harness.' }
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $repository '.local\network-observation.json')
$report | ConvertTo-Json -Depth 5
