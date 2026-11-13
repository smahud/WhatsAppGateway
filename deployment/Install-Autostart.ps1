$ErrorActionPreference = 'Stop'
$wgRoot = Split-Path -Parent $PSScriptRoot
$wgAction = New-ScheduledTaskAction -Execute (Join-Path $wgRoot 'node.exe') -Argument ('"' + (Join-Path $PSScriptRoot 'supervisor.js') + '"') -WorkingDirectory $wgRoot
$wgTrigger = New-ScheduledTaskTrigger -AtStartup
$wgSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'WAGW-JIBAS-Bridge' -Action $wgAction -Trigger $wgTrigger -Settings $wgSettings -User 'SYSTEM' -RunLevel Highest -Description 'WAGW and JIBAS outbox bridge; original sources unchanged.' -Force | Select-Object TaskName,State
