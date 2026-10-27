param([Parameter(Mandatory = $true)][string]$PythonExecutable)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot '.tmp'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logPath = Join-Path $logDirectory 'email-worker.log'

try {
    # Task Scheduler can retain an old environment from before database setup.
    # Read the current user's persistent settings without logging their values.
    foreach ($setting in @('DB_ENGINE', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT')) {
        $value = [Environment]::GetEnvironmentVariable($setting, 'User')
        if ($null -eq $value) {
            $value = [Environment]::GetEnvironmentVariable($setting, 'Machine')
        }
        [Environment]::SetEnvironmentVariable($setting, $value, 'Process')
    }
    if ([string]::IsNullOrWhiteSpace($env:DB_ENGINE)) {
        throw 'Set a persistent DB_ENGINE before running the scheduled email worker.'
    }
    Set-Location -LiteralPath $projectRoot
    # Overwrite each run to keep this local operational log bounded.
    & $PythonExecutable (Join-Path $projectRoot 'backend/manage.py') send_pending_emails *> $logPath
    exit $LASTEXITCODE
} catch {
    'Email worker failed to start. Check Python and persistent database settings.' | Set-Content -LiteralPath $logPath
    exit 1
}
