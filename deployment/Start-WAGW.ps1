$ErrorActionPreference = 'Stop'
$wgRoot = Split-Path -Parent $PSScriptRoot
$wgPidFile = Join-Path $PSScriptRoot 'wabot.pid'
if (Test-Path -LiteralPath $wgPidFile) {
    $wgExisting = Get-Process -Id ([int](Get-Content -LiteralPath $wgPidFile)) -ErrorAction SilentlyContinue
    if ($wgExisting -and $wgExisting.Path -eq (Join-Path $wgRoot 'node.exe')) {
        Write-Output "WAGW already running, PID $($wgExisting.Id)"
        exit
    }
}
$wgProcess = Start-Process -FilePath (Join-Path $wgRoot 'node.exe') -ArgumentList 'deployment/supervisor.js' -WorkingDirectory $wgRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'supervisor.log') -RedirectStandardError (Join-Path $PSScriptRoot 'supervisor-error.log') -PassThru
$wgProcess.Id | Set-Content -LiteralPath $wgPidFile
Write-Output "WAGW started, PID $($wgProcess.Id). Dashboard: http://localhost:3000"
