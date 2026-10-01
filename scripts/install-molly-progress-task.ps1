# Registers the daily 8pm "Molly's progress" job in Windows Task Scheduler (current user, no admin needed).
#   powershell -ExecutionPolicy Bypass -File scripts\install-molly-progress-task.ps1            # install / update
#   powershell -ExecutionPolicy Bypass -File scripts\install-molly-progress-task.ps1 -Remove     # uninstall
param([string]$Time = "20:00", [switch]$Remove)

$name = "Rehyn Molly Progress"
if ($Remove) { Unregister-ScheduledTask -TaskName $name -Confirm:$false; Write-Host "Removed '$name'."; return }

$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$script = Join-Path $root "scripts\molly-progress.mjs"
$log = Join-Path $root ".molly-progress\task.log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null

# cmd wrapper so the run's output lands in a log file Molly can read
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"`"$node`" `"$script`" >> `"$log`" 2>&1`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
# StartWhenAvailable: if the PC was off at 8pm, run as soon as it is back on.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description "Saves Molly's local edits, summarises them and publishes the summary to the Rehyn site." -Force | Out-Null
Write-Host "Scheduled '$name' daily at $Time. Log: $log"
