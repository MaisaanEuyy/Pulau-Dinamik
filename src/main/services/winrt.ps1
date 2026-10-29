# Windows WinRT bridge for the media panel and the Alerts panel.
#
# A single long-lived PowerShell 5.1 process serves both features: SMTC cover
# art/playback state and Windows' notification centre. Two separate helpers
# would double the CLR + PowerShell baseline (the largest chunk of the app's
# memory use), so they share one process and one stdin/stdout pipe.
#
# stdout: one JSON object per line
#   {"type":"access","access":"Allowed"}
#   {"type":"toast","key":"…","app":"Discord","texts":[…],"created":1699…}
#   {"type":"state","active":true,"playing":true,…}
#
# stdin: `media:on` / `media:off` gates the media polling; while it is on the
# plain commands `toggle`, `next`, `previous`, `play`, `pause` are accepted.
#
# Nothing is written to disk and no notification content ever leaves the
# machine. The helper exits when the main process closes its stdin pipe.
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

# ---------------------------------------------------------------- notifications
# A failure here must not take the media half down with it.
$listener = $null
$toastAccess = $false
try {
  [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications.Management, ContentType = WindowsRuntime] | Out-Null
  [Windows.UI.Notifications.NotificationKinds, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null

  $listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
  $access = $listener.GetAccessStatus()

  # First run: Windows asks the user once ("let this app read your notifications").
  if ("$access" -ne 'Allowed') {
    try {
      $access = Await ($listener.RequestAccessAsync()) ([Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus])
    } catch {
      $access = 'Denied'
    }
  }

  Send @{ type = 'access'; access = "$access" }
  $toastAccess = ("$access" -eq 'Allowed')
} catch {
  Send @{ type = 'access'; access = 'Denied' }
}

# ----------------------------------------------------------------------- media
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
# The UI only ever shows the current track, so a handful of covers is plenty.
$artCache = @{}
$artCacheLimit = 4

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
  # Chrome appends the profile to its model id ("Chrome.UserData.Profile1").
  $name = $name -replace '\.UserData.*$', ''

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
    if ($artCache.Count -ge $artCacheLimit) { $artCache.Clear() }
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

# ------------------------------------------------------------------------ loop
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$mediaEnabled = $false
$seen = @{}
$seenOrder = New-Object System.Collections.Queue
$ticks = 0
$lastJson = ''
$forceAt = 0
$lastGc = 0

function Add-Seen([string]$key) {
  $seen[$key] = $true
  $seenOrder.Enqueue($key)
  # Bound the history: notification keys are tiny, but the helper lives for days.
  while ($seenOrder.Count -gt 512) {
    $seen.Remove([string]$seenOrder.Dequeue())
  }
}

try {
  while ($true) {
    # Commands are cheap to poll, so hit stdin every 50 ms for snappy buttons.
    if ($pending.IsCompleted) {
      $line = $pending.Result
      if ($null -eq $line) { break }
      $command = $line.Trim().ToLowerInvariant()

      if ($command -eq 'media:on') {
        if (-not $mediaEnabled) {
          $mediaEnabled = $true
          $script:manager = $null
          $lastJson = ''
          $forceAt = [Environment]::TickCount + 120
        }
      } elseif ($command -eq 'media:off') {
        if ($mediaEnabled) {
          $mediaEnabled = $false
          $script:manager = $null
          $artCache.Clear()
          [GC]::Collect()
        }
      } elseif ($mediaEnabled -and $command) {
        Invoke-Command $command
        $forceAt = [Environment]::TickCount + 120
        $lastJson = ''
      }

      $pending = $stdin.ReadLineAsync()
    }

    # Notifications: ~600 ms between reads.
    if ($toastAccess -and (($ticks % 12) -eq 0)) {
      try {
        $operation = $listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)
        $items = Await $operation ([System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]])

        foreach ($item in $items) {
          $created = $item.CreationTime.ToUnixTimeMilliseconds()
          $key = "$($item.AppInfo.AppUserModelId)|$($item.Id)|$created"
          if ($seen.ContainsKey($key)) { continue }
          Add-Seen $key

          $texts = New-Object System.Collections.ArrayList
          try {
            $binding = $item.Notification.Visual.Bindings[0]
            foreach ($element in $binding.GetTextElements()) {
              [void]$texts.Add([string]$element.Text)
            }
          } catch {
            # Some toasts carry no text binding at all (image/progress only).
          }

          $app = [string]$item.AppInfo.DisplayInfo.DisplayName
          if ([string]::IsNullOrWhiteSpace($app)) { $app = [string]$item.AppInfo.AppUserModelId }

          Send @{
            type = 'toast'
            key = $key
            app = $app
            texts = @($texts)
            created = $created
          }
        }
      } catch {
        # Sleep/resume or a locked notification store: keep the loop alive.
      }
    }

    # Media: ~750 ms, plus an immediate read after a command or `media:on`.
    if ($mediaEnabled -and ((($ticks % 15) -eq 0) -or ($forceAt -ne 0 -and [Environment]::TickCount -ge $forceAt))) {
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

    # Hand the CLR a chance to release heap once a minute.
    if (($ticks - $lastGc) -ge 1200) {
      $lastGc = $ticks
      [GC]::Collect()
    }

    Start-Sleep -Milliseconds 50
    $ticks += 1
  }
} finally {
  $stdout.Flush()
  $stdout.Dispose()
}