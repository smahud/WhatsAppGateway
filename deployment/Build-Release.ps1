$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist ('stage-' + [guid]::NewGuid().ToString('N'))
$archive = Join-Path $dist ('jibas-wg-source-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
$top = @('install.sh','uninstall.sh','gateway.js','wabot.js','package.json','package-lock.json','config.example.json','README.md',
    'CONTRACT.md','tutorial.html','ReadMe.TXT','.gitignore','.gitattributes',
    'Install_to_Windows_Service.bat','Uninstall_Windows_Service.bat','Install_Service.js')
try {
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    foreach ($name in $top) {
        Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $stage $name)
    }
    foreach ($folder in @('public','create tables','deployment')) {
        foreach ($file in Get-ChildItem -LiteralPath (Join-Path $root $folder) -Recurse -File) {
            if ($file.Extension -notin @('.js','.json','.md','.sql','.ps1','.sh','.service','.html','.css','.py')) { continue }
            $relative = $file.FullName.Substring($root.Length + 1)
            if ($relative -match '(?i)(^|[\\/])(?:sessions|daemon|dist|node_modules|\.runtime|\.git)([\\/]|$)' -or
                $file.Name -match '^(last-test\.json|config\.json|dashboard-auth\.json|github\.pat\..*|\.env(\..*)?)$') { continue }
            if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Not a regular source file: $relative" }
            $target = Join-Path $stage $relative
            New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
            Copy-Item -LiteralPath $file.FullName -Destination $target
        }
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $archive)
    Get-FileHash -LiteralPath $archive -Algorithm SHA256 | Format-List
    Write-Output "Release: $archive"
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
