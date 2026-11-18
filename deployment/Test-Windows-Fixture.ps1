# Creates an isolated MariaDB from already-downloaded Windows binaries. Does not connect to production.
param(
    [Parameter(Mandatory)][string]$MariaDbBin,
    [ValidateSet('jibas_wg','wagw')][string]$Schema = 'jibas_wg',
    [Parameter(Mandatory)][string]$TempRoot
)
$ErrorActionPreference = 'Stop'
$fixture = Join-Path (Resolve-Path -LiteralPath $TempRoot).Path ('jibas-wg-fixture-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$data = Join-Path $fixture 'data'
$wire = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$wire.Start()
$port = $wire.LocalEndpoint.Port
$wire.Stop()
$password = 'F!' + [guid]::NewGuid().ToString('N')
$oldPassword = $env:MYSQL_PWD
$env:MYSQL_PWD = $password
$server = $null
$db = @('--no-defaults','--host=127.0.0.1',"--port=$port",'--user=root')
try {
    & (Join-Path $MariaDbBin 'mariadb-install-db.exe') "--datadir=$data" "--password=$password" "--port=$port" --silent | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Fixture MariaDB initialization failed.' }
    $server = Start-Process -FilePath (Join-Path $MariaDbBin 'mariadbd.exe') `
        -ArgumentList ('--no-defaults --console --bind-address=127.0.0.1 --port=' + $port + ' --datadir="' + $data + '"') `
        -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $fixture 'server.log') -RedirectStandardError (Join-Path $fixture 'error.log')
    $ready = $false
    for ($i=0;$i -lt 40;$i++) {
        $client = [Net.Sockets.TcpClient]::new()
        try { $client.Connect('127.0.0.1',$port); $ready = $true; break }
        catch {} finally { $client.Dispose() }
        if ($server.HasExited) { break }
        Start-Sleep -Milliseconds 250
    }
    if (!$ready) { throw 'Disposable MariaDB did not become ready.' }
    Get-Content -LiteralPath (Join-Path $PSScriptRoot 'fixture-schema.sql') -Raw |
        & (Join-Path $MariaDbBin 'mariadb.exe') @db
    if ($LASTEXITCODE -ne 0) { throw 'Failed to seed disposable JIBAS schema.' }
    $config = Join-Path $fixture 'fixture-config.json'
    @{
        db_type='mysql'; host='127.0.0.1'; database=$Schema; user='root'; password=$password
        db_port=$port; timezone='+07:00'; port=3000; delay=1
    } | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding UTF8
    & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass `
        -File (Join-Path $PSScriptRoot 'Test-Windows-Service.ps1') -FixtureConfig $config
    if ($LASTEXITCODE -ne 0) { throw 'Isolated Windows installer test failed.' }
} finally {
    if ($server -and !$server.HasExited) {
        & (Join-Path $MariaDbBin 'mariadb-admin.exe') @db shutdown
        if (!$server.WaitForExit(7000)) { Stop-Process -InputObject $server -Force }
    }
    $env:MYSQL_PWD = $oldPassword
    if ((Split-Path -Leaf $fixture) -match '^jibas-wg-fixture-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $fixture -Recurse -Force
    }
}
