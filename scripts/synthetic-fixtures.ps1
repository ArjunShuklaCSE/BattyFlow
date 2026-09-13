$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$repository = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repository 'benchmark\manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$destination = Join-Path $repository 'benchmark\fixtures\generated'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @($speech.GetInstalledVoices() | Where-Object Enabled | ForEach-Object { $_.VoiceInfo.Name })
if ($voices.Count -eq 0) { throw 'No installed System.Speech voice. Import consented 16 kHz PCM16 mono recordings instead.' }
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
try {
  $index = 0
  foreach ($fixture in $manifest.fixtures) {
    $path = Join-Path $destination ($fixture.id + '.wav')
    $voice = $voices[$index % $voices.Count]
    if ($fixture.spoken.Length -gt 0) {
      $speech.SelectVoice($voice)
      $speech.Rate = 0
      $speech.SetOutputToWaveFile($path, $format)
      $speech.Speak($fixture.spoken)
      $speech.SetOutputToNull()
    } else {
      $samples = 32000
      $stream = [System.IO.File]::Create($path)
      $writer = New-Object System.IO.BinaryWriter($stream)
      $writer.Write([Text.Encoding]::ASCII.GetBytes('RIFF')); $writer.Write([int](36 + $samples*2)); $writer.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt ')); $writer.Write([int]16); $writer.Write([int16]1); $writer.Write([int16]1); $writer.Write([int]16000); $writer.Write([int]32000); $writer.Write([int16]2); $writer.Write([int16]16); $writer.Write([Text.Encoding]::ASCII.GetBytes('data')); $writer.Write([int]($samples*2))
      $random = New-Object System.Random(42)
      for ($i=0; $i -lt $samples; $i++) { $sample = 0; if ($fixture.id -eq 'quiet-noise') { $sample = $random.Next(-120,121) }; $writer.Write([int16]$sample) }
      $writer.Dispose(); $stream.Dispose(); $voice = 'none; deterministic generated PCM'
    }
    $fixture | Add-Member -NotePropertyName audio -NotePropertyValue ('fixtures/generated/' + $fixture.id + '.wav') -Force
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($path))).Replace('-','').ToLower() } finally { $hasher.Dispose() }
    $fixture | Add-Member -NotePropertyName sha256 -NotePropertyValue $hash -Force
    $fixture | Add-Member -NotePropertyName language -NotePropertyValue 'en' -Force
    $fixture | Add-Member -NotePropertyName provenance -NotePropertyValue ('Synthetic: Windows System.Speech; ' + $voice + '; original test text. No human speaker.') -Force
    $fixture | Add-Member -NotePropertyName license -NotePropertyValue 'Text MIT; voice output local evaluation only; redistribution unverified' -Force
    $fixture | Add-Member -NotePropertyName duration -NotePropertyValue 0 -Force
    $index++
  }
} finally { $speech.Dispose() }
$json = $manifest | ConvertTo-Json -Depth 12
[IO.File]::WriteAllText($manifestPath,$json,(New-Object Text.UTF8Encoding($false)))
Write-Output ('Generated ' + $manifest.fixtures.Count + ' synthetic clips. Run node scripts/finalize-fixtures.mjs to calculate exact WAV durations.')
