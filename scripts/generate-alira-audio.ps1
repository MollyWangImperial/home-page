param([Parameter(Mandatory=$true)][string]$RepositoryRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$manifest = Get-Content -LiteralPath (Join-Path $RepositoryRoot 'client/src/lib/alira-voice-clips.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $speaker.SelectVoice('Microsoft Zira Desktop')
  $speaker.Rate = -1
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  foreach ($entry in $manifest.PSObject.Properties) {
    $target = Join-Path (Join-Path $RepositoryRoot 'client/public') $entry.Value.TrimStart('/')
    $speaker.SetOutputToWaveFile($target, $format)
    $speaker.Speak($entry.Name)
    $speaker.SetOutputToNull()
  }
} finally { $speaker.Dispose() }
