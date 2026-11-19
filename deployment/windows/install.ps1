$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'common.ps1')
$options = @($args)
$manager = Join-Path $PSScriptRoot 'manage-service.ps1'
$installer = Join-Path $JibasRoot 'Install_Service.js'
$runtime = Join-Path $JibasRoot '.runtime'

function Invoke-Manager([string]$Action) {
    & $JibasWindowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $manager -Action $Action
    if ($LASTEXITCODE -ne 0) { throw "Instalasi dihentikan pada tahap $Action (lihat pesan di atas)." }
}

function Test-NodeVersion([string]$Executable) {
    if (!$Executable) { return $false }
    $version = & $Executable --version
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.(\d+)\.') { return $false }
    return [int]$Matches[1] -in 23,24 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -ge 14)
}

function Get-NodeBundle {
    $node = Join-Path $runtime 'node\node.exe'
    $npm = Join-Path $runtime 'node\node_modules\npm\bin\npm-cli.js'
    if ((Test-Path -LiteralPath $node) -and (Test-Path -LiteralPath $npm) -and (Test-NodeVersion $node)) { return }
    $machine = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $arch = switch ($machine) { AMD64 {'x64'} ARM64 {'arm64'} default { throw "Arsitektur Windows tidak didukung: $machine" } }
    $version = 'v22.23.5'
    $digest = if ($arch -eq 'x64') {
        '4a191082e9706866830379d577d2cc8a50c776fcd9436a8d061b063ed0d9a0e3'
    } else {
        'c1856817f611738c77534efbff8a5a17990593eab24046bc8d2c23a77a160d13'
    }
    $folder = "node-$version-win-$arch"
    $temp = Join-Path $runtime ('download-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temp | Out-Null
    try {
        Write-Output "Menyiapkan Node.js $version ($arch) untuk JIBAS WG."
        $zip = Join-Path $temp 'node.zip'
        $uri = "https://nodejs.org/dist/$version/$folder.zip"
        $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
        if (Test-Path -LiteralPath $curl) {
            & $curl --fail --silent --show-error --location --proto '=https' --max-time 120 --output $zip $uri
            if ($LASTEXITCODE -ne 0) { throw 'Unduhan runtime Node gagal.' }
        } else {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $zip -TimeoutSec 120
        }
        if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ine $digest) { throw 'Checksum runtime Node tidak cocok.' }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($zip, $temp)
        $target = Join-Path $runtime 'node'
        if (Test-Path -LiteralPath $target) {
            Move-Item -LiteralPath $target -Destination (Join-Path $runtime ('node.previous-' + [guid]::NewGuid().ToString('N')))
        }
        Move-Item -LiteralPath (Join-Path $temp $folder) -Destination $target
    } finally { Remove-Item -LiteralPath $temp -Recurse -Force }
}

try {
    if ($options -contains '--help' -or $options -contains '-h') {
        Write-Output 'JIBAS WhatsApp Gateway - gunakan .\Install-Windows-Service.ps1 -Help.'
        exit 0
    }
    Assert-JibasAdmin
    if ($options -contains '--credentials-only') {
        $node = Get-JibasNode
        if (!$node) { throw 'Pasang JIBAS WG sebelum mengubah login dashboard.' }
        exit (Invoke-JibasNativeProcess $node (@($installer) + $options))
    }
    Invoke-Manager 'Preflight'
    Invoke-Manager 'Protect'
    if (!(Test-Path -LiteralPath $runtime)) { New-Item -ItemType Directory -Path $runtime | Out-Null }
    if ((Get-Item -LiteralPath $runtime).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Folder .runtime tidak boleh berupa junction/symlink.' }
    $node = Get-JibasNode
    $profileRoot = (Split-Path -Parent $env:USERPROFILE).TrimEnd('\') + '\'
    if ($node -and $node.StartsWith($profileRoot, [StringComparison]::OrdinalIgnoreCase)) { $node = $null }
    if (!(Test-NodeVersion $node)) {
        Get-NodeBundle
        $node = Join-Path $runtime 'node\node.exe'
    }
    $env:PATH = (Split-Path -Parent $node) + ';' + $env:PATH
    $lock = Join-Path $JibasRoot 'package-lock.json'
    $stampPath = Join-Path $runtime 'dependency-sha256'
    $tree = Join-Path $JibasRoot 'node_modules'
    $digest = (Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash
    $winSW = 'node-windows\bin\winsw\winsw.exe'
    $requiredFiles = @($winSW,'mysql2\promise.js','express\index.js','bcryptjs\umd\index.js',
        '@whiskeysockets\baileys\lib\index.js','libsignal\index.js')
    $missing = @($requiredFiles | Where-Object { !(Test-Path -LiteralPath (Join-Path $tree $_) -PathType Leaf) })
    $pending = $null
    if (!(Test-Path -LiteralPath $stampPath) -or (Get-Content -LiteralPath $stampPath -Raw).Trim() -ne $digest -or
        $missing.Count -gt 0) {
        $npm = Join-Path (Split-Path -Parent $node) 'node_modules\npm\bin\npm-cli.js'
        if (!(Test-Path -LiteralPath $npm)) {
            Get-NodeBundle
            $npm = Join-Path $runtime 'node\node_modules\npm\bin\npm-cli.js'
        }
        $pending = Join-Path $runtime ('dependencies-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $pending | Out-Null
        Copy-Item -LiteralPath $lock,(Join-Path $JibasRoot 'package.json') -Destination $pending
        Write-Output 'Memasang dependensi JIBAS WG sebelum menghentikan instance lama.'
        & $node $npm --prefix $pending ci --omit=dev --no-fund --no-audit --prefer-offline
        if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath (Join-Path $pending "node_modules\$winSW"))) { throw 'Dependensi service belum lengkap.' }
    }
    $env:JIBAS_WG_INSTALL_PHASE = 'check'
    if ($pending) { $env:NODE_PATH = Join-Path $pending 'node_modules' }
    $check = Invoke-JibasNativeProcess $node (@($installer) + $options)
    if ($check -ne 0) { exit $check }
    Invoke-Manager 'RepairStop'
    if ($pending) {
        if (Test-Path -LiteralPath $tree) {
            Move-Item -LiteralPath $tree -Destination (Join-Path $runtime ('dependencies.previous-' + [guid]::NewGuid().ToString('N')))
        }
        Move-Item -LiteralPath (Join-Path $pending 'node_modules') -Destination $tree
        Set-Content -LiteralPath $stampPath -Value $digest -Encoding ASCII
        Remove-Item Env:NODE_PATH -ErrorAction SilentlyContinue
    }
    $env:JIBAS_WG_INSTALL_PHASE = 'apply'
    exit (Invoke-JibasNativeProcess $node (@($installer) + $options))
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($pending -and (Test-Path -LiteralPath $pending)) {
        Remove-Item -LiteralPath $pending -Recurse -Force -ErrorAction SilentlyContinue
    }
}
