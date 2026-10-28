# Windows SMTC bridge for the media panel.
#
# Prints one JSON object per line on stdout and accepts plain-text commands on
# stdin (`toggle`, `next`, `previous`, `play`, `pause`). Kept alive by the main
# process so each poll costs a few milliseconds instead of a process start.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$utf8 = New-Object System.Text.UTF8Encoding $false
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$stdout.AutoFlush = $true

function Send([hashtable]$payload) {
  $stdout.WriteLine(($payload | ConvertTo-Json -Compress -Depth 6))
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($operation, $type) {
  $asTask = $asTaskGeneric.MakeGenericMethod($type)
  $netTask = $asTask.Invoke($null, @($operation))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]

# PowerShell cannot bind a WinRT stream to a method parameter, but reflection
# performs the COM cast for us. This is the only way to turn cover art into
# bytes without a compiled helper.
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1
} | Select-Object -First 1

$script:manager = $null
$artCache = @{}

function Get-Manager {
  if ($null -eq $script:manager) {
    $script:manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  }
  return $script:manager
}

# A playing session always wins: the user may keep a paused player in the
# background while a video is running elsewhere. Ties fall back to the session
# Windows considers current (the same one the media flyout shows).
function Get-Session {
  $manager = Get-Manager
  $sessions = @($manager.GetSessions())
  $current = $manager.GetCurrentSession()

  if ($null -ne $current -and $current.GetPlaybackInfo().PlaybackStatus -eq 'Playing') {
    return $current
  }
  foreach ($session in $sessions) {
    if ($session.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { return $session }
  }
  if ($null -ne $current) { return $current }
  if ($sessions.Count -gt 0) { return $sessions[0] }
  return $null
}

function Format-AppName([string]$id) {
  if (-not $id) { return $null }

  # Packaged apps use "PackageFamilyName!AppId" as their model id.
  $name = $id
  $bang = $name.IndexOf('!')
  if ($bang -ge 0) { $name = $name.Substring($bang + 1) }
  if ($name -like '*\*') { $name = Split-Path $name -Leaf }
  $name = $name -replace '\.exe$', ''

  switch ($name) {
    'MSEdge' { return 'Edge' }
    'chrome' { return 'Google Chrome' }
    'Microsoft.ZuneMusic' { return 'Media Player' }
    'Music.UI' { return 'Media Player' }
  }
  return $name
}

function Read-Artwork($reference, [string]$key) {
  if ($artCache.ContainsKey($key)) { return $artCache[$key] }
  if ($null -eq $reference -or $null -eq $asStreamForRead) { return $null }

  $stream = $null
  $net = $null
  try {
    $stream = Await ($reference.OpenReadAsync()) $streamType
    $net = $asStreamForRead.Invoke($null, @($stream))

    # Bounded copy: covers are small, anything huge is not worth an IPC hit.
    $memory = New-Object System.IO.MemoryStream
    $buffer = New-Object byte[] 8192
    while ($true) {
      $read = $net.Read($buffer, 0, $buffer.Length)
      if ($read -le 0) { break }
      $memory.Write($buffer, 0, $read)
      if ($memory.Length -gt 4194304) { return $null }
    }

    $bytes = $memory.ToArray()
    if ($bytes.Length -lt 8) { return $null }

    $mime = 'image/png'
    if ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8) { $mime = 'image/jpeg' }

    $url = 'data:' + $mime + ';base64,' + [Convert]::ToBase64String($bytes)
    if ($artCache.Count -gt 24) { $artCache.Clear() }
    $artCache[$key] = $url
    return $url
  } catch {
    return $null
  } finally {
    # The wrapper owns the WinRT stream; the RCW itself has no Dispose.
    if ($net) { $net.Dispose() }
  }
}

function Read-State {
  $session = Get-Session
  if ($null -eq $session) {
    return @{
      type = 'state'; active = $false; playing = $false; title = $null
      artist = $null; album = $null; app = $null; canPlayPause = $false
      canNext = $false; canPrevious = $false; artwork = $null
    }
  }

  $info = $session.GetPlaybackInfo()
  $properties = Await ($session.TryGetMediaPropertiesAsync()) $propsType
  $controls = $info.Controls

  $app = Format-AppName $session.SourceAppUserModelId
  $title = $properties.Title
  $artist = $properties.Artist

  # Only one entry per track is ever produced, so the cache key is enough.
  $artwork = Read-Artwork $properties.Thumbnail ("{0}|{1}|{2}" -f $app, $title, $artist)
  $canPlayPause = ($controls.IsPlayPauseToggleEnabled -or $controls.IsPlayEnabled -or $controls.IsPauseEnabled)

  return @{
    type = 'state'; active = $true; playing = ($info.PlaybackStatus -eq 'Playing')
    title = $title; artist = $artist; album = $properties.AlbumTitle
    app = $app; canPlayPause = [bool]$canPlayPause
    canNext = [bool]$controls.IsNextEnabled
    canPrevious = [bool]$controls.IsPreviousEnabled
    artwork = $artwork
  }
}

function Invoke-Command([string]$command) {
  $session = Get-Session
  if ($null -eq $session) { return }
  try {
    switch ($command) {
      'toggle' { [void](Await ($session.TryTogglePlayPauseAsync()) ([bool])) }
      'next' { [void](Await ($session.TrySkipNextAsync()) ([bool])) }
      'previous' { [void](Await ($session.TrySkipPreviousAsync()) ([bool])) }
      'play' { [void](Await ($session.TryPlayAsync()) ([bool])) }
      'pause' { [void](Await ($session.TryPauseAsync()) ([bool])) }
    }
  } catch {
    # Most likely the session disappeared mid-call: rebuild the manager.
    $script:manager = $null
  }
}

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$lastJson = ''
$ticks = 0
$forceAt = 0

try {
  while ($true) {
    # Commands are cheap to poll, so hit stdin every 50 ms for snappy buttons.
    if ($pending.IsCompleted) {
      $line = $pending.Result
      if ($null -eq $line) { break }
      Invoke-Command $line.Trim().ToLowerInvariant()
      $pending = $stdin.ReadLineAsync()
      $forceAt = [Environment]::TickCount + 120
      $lastJson = ''
    }

    if ((($ticks % 15) -eq 0) -or ($forceAt -ne 0 -and [Environment]::TickCount -ge $forceAt)) {
      try {
        $state = Read-State
        $json = $state | ConvertTo-Json -Compress -Depth 6
        if ($json -ne $lastJson) {
          Send $state
          $lastJson = $json
        }
        $forceAt = 0
      } catch {
        # Sleep/resume or a closed player can invalidate the manager.
        $script:manager = $null
      }
    }

    Start-Sleep -Milliseconds 50
    $ticks += 1
  }
} finally {
  $stdout.Flush()
  $stdout.Dispose()
}