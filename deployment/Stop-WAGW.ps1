$wgRoot = Split-Path -Parent $PSScriptRoot
$wgPidFile = Join-Path $PSScriptRoot 'wabot.pid'
if (Test-Path -LiteralPath $wgPidFile) {
    $wgProcess = Get-Process -Id ([int](Get-Content -LiteralPath $wgPidFile)) -ErrorAction SilentlyContinue
    if ($wgProcess -and $wgProcess.Path -eq (Join-Path $wgRoot 'node.exe')) {
        Stop-Process -Id $wgProcess.Id -ErrorAction Stop
        Write-Output 'WAGW stopped.'
    }
}
foreach ($wgChild in @('gateway','bridge')) {
    $wgChildFile = Join-Path $PSScriptRoot ($wgChild + '.pid')
    if (Test-Path -LiteralPath $wgChildFile) {
        $wgChildProcess = Get-Process -Id ([int](Get-Content -LiteralPath $wgChildFile)) -ErrorAction SilentlyContinue
        if ($wgChildProcess -and $wgChildProcess.Path -eq (Join-Path $wgRoot 'node.exe')) {
            Stop-Process -Id $wgChildProcess.Id -ErrorAction Stop
        }
    }
}
