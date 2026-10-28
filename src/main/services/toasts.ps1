# Windows toast bridge for the Alerts panel.
#
# Reads the Windows notification centre through the WinRT
# `UserNotificationListener` and prints one JSON object per line on stdout:
#
#   {"type":"access","access":"Allowed"}
#   {"type":"toast","key":"…","app":"Discord","texts":["Title","Body"],"created":1699…}
#
# Nothing is written to disk and no notification content ever leaves the machine.
# The helper exits when the main process closes its stdin pipe.
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

if ("$access" -ne 'Allowed') {
  $stdout.Flush()
  $stdout.Dispose()
  exit 0
}

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$seen = @{}
$ticks = 0

try {
  while ($true) {
    # Exits as soon as the app closes our stdin pipe (hide, quit, crash).
    if ($pending.IsCompleted -and $null -eq $pending.Result) { break }

    # ~600 ms between reads: the WinRT call is cheap but not free.
    if (($ticks % 12) -eq 0) {
      try {
        $operation = $listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)
        $items = Await $operation ([System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]])

        foreach ($item in $items) {
          $created = $item.CreationTime.ToUnixTimeMilliseconds()
          $key = "$($item.AppInfo.AppUserModelId)|$($item.Id)|$created"
          if ($seen.ContainsKey($key)) { continue }
          $seen[$key] = $true

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

    Start-Sleep -Milliseconds 50
    $ticks += 1
  }
} finally {
  $stdout.Flush()
  $stdout.Dispose()
}