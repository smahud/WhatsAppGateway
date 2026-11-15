$ErrorActionPreference = 'Stop'
$wgRoot = Split-Path -Parent $PSScriptRoot
$wgDist = Join-Path $wgRoot 'dist'
$wgStage = Join-Path $wgDist ('stage-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $wgStage -Force | Out-Null
$wgTopFiles = @('install.sh','wabot.js','webhook.php','package.json','package-lock.json','config.example.json','README.md','CONTRACT.md','tutorial.html','ReadMe.TXT','.gitignore','.gitattributes')
foreach ($wgFile in $wgTopFiles) { Copy-Item -LiteralPath (Join-Path $wgRoot $wgFile) -Destination (Join-Path $wgStage $wgFile) }
foreach ($wgDirectory in @('public','create tables','deployment')) {
    $wgSource = Join-Path $wgRoot $wgDirectory
    foreach ($wgFile in Get-ChildItem -LiteralPath $wgSource -Recurse -File) {
        if ($wgFile.Extension -notin @('.js','.json','.md','.sql','.ps1','.sh','.service','.html','.css')) { continue }
        if ($wgFile.Name -in @('last-test.json','config.json')) { continue }
        $wgRelative = $wgFile.FullName.Substring($wgRoot.Length + 1)
        $wgTarget = Join-Path $wgStage $wgRelative
        New-Item -ItemType Directory -Path (Split-Path -Parent $wgTarget) -Force | Out-Null
        Copy-Item -LiteralPath $wgFile.FullName -Destination $wgTarget
    }
}
$wgArchive = Join-Path $wgDist ('wagw-vps-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
Compress-Archive -Path (Join-Path $wgStage '*') -DestinationPath $wgArchive
Get-FileHash -LiteralPath $wgArchive -Algorithm SHA256 | Format-List
Write-Output "Release: $wgArchive"
