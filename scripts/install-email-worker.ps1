param([Parameter(Mandatory = $true)][string]$PythonExecutable)

$ErrorActionPreference = 'Stop'
$pythonPath = (Resolve-Path -LiteralPath $PythonExecutable).Path
$projectRoot = Split-Path -Parent $PSScriptRoot
$workerPath = Join-Path $PSScriptRoot 'run-email-worker.ps1'
$launcherPath = Join-Path $PSScriptRoot 'run_email_worker_hidden.py'
$pythonWindowlessPath = Join-Path (Split-Path -Parent $pythonPath) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonWindowlessPath)) {
    throw 'The Python installation must include pythonw.exe for windowless email delivery.'
}
$taskName = 'GraveTrak Email Notifications'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
# A console executable can flash before -WindowStyle Hidden takes effect.
# Start with pythonw, then create PowerShell with CREATE_NO_WINDOW.
$arguments = '"{0}"' -f $launcherPath
$action = New-ScheduledTaskAction -Execute $pythonWindowlessPath -Argument $arguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and ($existing.Actions.Arguments -notlike ('*"' + $workerPath + '"*')) -and ($existing.Actions.Arguments -ne $arguments)) {
    throw 'A GraveTrak email task already belongs to a different checkout. Review it before replacing it.'
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Submit new GraveTrak email notifications every minute while this Windows user is logged in.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'GraveTrak email worker installed: every minute while logged in.'
