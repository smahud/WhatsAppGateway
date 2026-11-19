# End-to-end installer test: pass an isolated loopback database containing an empty JIBAS outbox.
param([Parameter(Mandatory)][string]$FixtureConfig, [string]$TempRoot = $env:ProgramData)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows\common.ps1')
Assert-JibasAdmin
$liveConfig = Join-Path $JibasRoot 'config.json'
$cfg = Get-Content -LiteralPath $FixtureConfig -Raw | ConvertFrom-Json
if ($cfg.db_type -ne 'mysql' -or $cfg.database -notin 'jibas_wg','wagw' -or $cfg.host -ne '127.0.0.1' -or [int]$cfg.db_port -eq 3306) {
    throw 'Use a disposable loopback MySQL/MariaDB with jbssms on a non-default port.'
}
if (Test-Path -LiteralPath $liveConfig) {
    $live = Get-Content -LiteralPath $liveConfig -Raw | ConvertFrom-Json
    if ([int]$live.db_port -eq [int]$cfg.db_port) { throw 'The fixture DB port cannot equal the production DB port.' }
}
$stamp = [guid]::NewGuid().ToString('N').Substring(0, 10)
$name = "JIBAS_WG-test-$stamp.exe"
$legacyName = "JIBAS_WG-legacy-test-$stamp.exe"
$stage = Join-Path (Resolve-Path -LiteralPath $TempRoot).Path "jibas wg service test $stamp"
$manager = Join-Path $stage 'deployment\windows\manage-service.ps1'
$psExe = Join-Path $PSHOME 'powershell.exe'
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$oldPath = $env:PATH
$oldGit = $env:NPM_CONFIG_GIT
$env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$PSHOME"
$env:NPM_CONFIG_GIT = 'C:\not-installed\git.exe'
$installer = Join-Path $stage 'Install-Windows-Service.ps1'
$uninstaller = Join-Path $stage 'Uninstall-Windows-Service.ps1'
$healthUrl = "http://127.0.0.1:$port"

function Install-Fixture {
    $ErrorActionPreference = 'Continue'
    $output = & $psExe -NoProfile -ExecutionPolicy Bypass -File $installer @args 2>&1
    return @{ExitCode=$LASTEXITCODE;Text=($output -join "`n")}
}

function Verify-Login([string]$User,[string]$Password,[bool]$Expected) {
    $node = Join-Path $stage '.runtime\node\node.exe'
    $env:FIXTURE_URL=$healthUrl; $env:FIXTURE_USER=$User; $env:FIXTURE_PASSWORD=$Password
    $env:FIXTURE_EXPECTED=[string]$Expected
    @'
const assert=require('node:assert/strict');
const {FIXTURE_URL:url,FIXTURE_USER:user,FIXTURE_PASSWORD:password,FIXTURE_EXPECTED:expected}=process.env;
(async()=>{
 const root=await fetch(url,{redirect:'manual'});
 assert.equal(root.status,303); assert.equal(root.headers.get('location'),'/login');
 assert.equal(root.headers.get('www-authenticate'),null);
 assert.match(await(await fetch(url+'/login')).text(),/Masuk ke JIBAS WhatsApp Gateway/);
 const login=await fetch(url+'/login',{redirect:'manual',method:'POST',body:new URLSearchParams({username:user,password})});
 if(expected==='True'){
  assert.equal(login.status,303);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.match(cookie,/^jibas_wg_session=/);
  assert.match(await(await fetch(url,{headers:{cookie}})).text(),/<title>JIBAS WhatsApp Gateway/);
  const resp=await fetch(url+'/api/status',{headers:{cookie}});
  assert.equal(resp.status,200);
  const status=await resp.json(); assert(status.jibas.workerRunning && status.jibas.moveEnabled);
  assert.equal((await fetch(url+'/api/apply-update',{method:'POST',headers:{cookie}})).status,403);
 }else assert.equal(login.status,401);
})().catch(err=>{console.error(err.message);process.exitCode=1;});
'@ | & $node -
    if ($LASTEXITCODE -ne 0) { throw 'Dashboard login fixture failed.' }
}

try {
    New-Item -ItemType Directory -Path $stage | Out-Null
    & icacls.exe $stage /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not protect fixture config.' }
    foreach ($file in @('Install-Windows-Service.ps1','Install_Service.js','Uninstall-Windows-Service.ps1','gateway.js','wabot.js','package.json','package-lock.json')) {
        Copy-Item -LiteralPath (Join-Path $JibasRoot $file) -Destination $stage
    }
    foreach ($entry in @($installer,$uninstaller)) {
        $helpText = & $psExe -NoProfile -ExecutionPolicy Bypass -File $entry -Help
        if ($LASTEXITCODE -ne 0 -or ($helpText -join "`n") -notmatch 'JIBAS WhatsApp Gateway') {
            throw "Help failed without Node/config: $entry"
        }
    }
    foreach ($directory in @('public','create tables')) {
        Copy-Item -LiteralPath (Join-Path $JibasRoot $directory) -Destination $stage -Recurse
    }
    $stagedDeployment = Join-Path $stage 'deployment'
    New-Item -ItemType Directory -Path $stagedDeployment | Out-Null
    foreach ($source in @('*.js','*.html','*.sql')) {
        Copy-Item -Path (Join-Path $PSScriptRoot $source) -Destination $stagedDeployment
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows') -Destination $stagedDeployment -Recurse
    $common = Join-Path $stage 'deployment\windows\common.ps1'
    (Get-Content -LiteralPath $common -Raw).Replace("'JIBAS_WG.exe'","'$name'").Replace("'wagwpro.exe'","'$legacyName'").Replace("'WAGW-JIBAS-Bridge'","'JIBAS_WG-test-$stamp'") | Set-Content -LiteralPath $common -Encoding UTF8
    $cfg | Add-Member -NotePropertyName port -NotePropertyValue $port -Force
    $cfg | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'config.json') -Encoding UTF8
    $foreign = Install-Fixture
    if ($foreign.ExitCode -eq 0 -or $foreign.Text -notmatch 'dipakai aplikasi lain' -or (Test-Path (Join-Path $stage '.runtime'))) {
        throw "Foreign port was not rejected before bootstrap: $($foreign.Text)"
    }
    Write-Output 'PASS: foreign port rejected; starting fresh runtime bootstrap.'
    $listener.Stop()
    $first = Install-Fixture
    if ($first.ExitCode -ne 0) { throw $first.Text }
    $match = [regex]::Match($first.Text,'Password dashboard \(ditampilkan sekali\): (\S+)')
    if (!$match.Success) { throw 'Fresh install did not generate dashboard credentials.' }
    $originalPassword = $match.Groups[1].Value
    Verify-Login 'admin' $originalPassword $true
    $before = Get-JibasHealth $port
    Write-Output 'PASS: automatic runtime/dependencies, JIBAS and generated login.'

    $repair = Install-Fixture
    if ($repair.ExitCode -ne 0 -or $repair.Text -notmatch 'Port .* milik JIBAS WG' -or $repair.Text -match 'Password dashboard \(ditampilkan sekali\)') {
        throw "Auto-repair failed: $($repair.Text)"
    }
    $after = Get-JibasHealth $port
    if (!$after -or $after.pid -eq $before.pid -or (Get-Process -Id $before.pid -ErrorAction SilentlyContinue)) {
        throw 'Repair did not replace its gateway process.'
    }
    Verify-Login 'admin' $originalPassword $true
    Write-Output 'PASS: repaired service with a fresh process and the same login.'

    # Re-register the disposable WinSW wrapper under a legacy identity to exercise migration.
    $daemon = Join-Path $stage 'daemon'
    $current = Join-Path $daemon $name
    $legacy = Join-Path $daemon $legacyName
    Copy-Item -LiteralPath $current -Destination $legacy
    Copy-Item -LiteralPath "$current.config" -Destination "$legacy.config"
    [xml]$legacyXml = Get-Content -Raw -LiteralPath ([IO.Path]::ChangeExtension($current,'.xml'))
    $legacyXml.service.id = $legacyName
    $legacyXml.service.name = 'Legacy fixture ' + $stamp
    $legacyXml.service.arguments = $legacyXml.service.arguments.Replace('start-gateway.js','start-wagw.js')
    $legacyXml.Save([IO.Path]::ChangeExtension($legacy,'.xml'))
    & $psExe -NoProfile -ExecutionPolicy Bypass -File $uninstaller
    if ($LASTEXITCODE -ne 0) { throw 'Could not unregister fresh fixture before migration test.' }
    $registered = Invoke-CimMethod -ClassName Win32_Service -MethodName Create -Arguments @{
        Name=$legacyName; DisplayName=("Legacy fixture $stamp"); PathName=('"'+$legacy+'"')
        ServiceType=[byte]16; ErrorControl=[byte]1; StartMode='Automatic'; StartName='NT AUTHORITY\LocalService'
    }
    if ($registered.ReturnValue -ne 0) { throw "Legacy fixture registration failed: $($registered.ReturnValue)" }
    New-EventLog -LogName Application -Source $legacyName
    Start-Service -Name $legacyName
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $legacyHealth = Get-JibasHealth $port
        if ($legacyHealth -and $legacyHealth.jibasReady) { break }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    if (!$legacyHealth -or !$legacyHealth.jibasReady) { throw 'Legacy fixture did not start.' }
    Write-Output 'PASS: legacy fixture is serving; migrating only its verified registration.'
    $sessionProbe = Join-Path $stage 'sessions\fixture.keep'
    Set-Content -LiteralPath $sessionProbe -Value 'Preserve on repair' -Encoding ASCII
    $migration = Install-Fixture
    if ($migration.ExitCode -ne 0 -or $migration.Text -notmatch 'Migrasi service' -or (Get-JibasScm $legacyName)) {
        throw "Legacy service migration failed: $($migration.Text)"
    }
    $upgraded = Get-JibasHealth $port
    if ($upgraded.pid -eq $legacyHealth.pid -or !(Test-Path -LiteralPath $sessionProbe)) { throw 'Legacy process or session preservation check failed.' }
    Verify-Login 'admin' $originalPassword $true

    Push-Location -LiteralPath $stage
    try {
        $passFile = '.\fixture rotated.pass'
        Set-Content -LiteralPath $passFile -Value 'Fixture second password' -Encoding UTF8
        & $installer -CredentialsOnly -User operator -PassFile $passFile
        if ($LASTEXITCODE -ne 0) { throw 'Credential rotation using a relative password file failed.' }
    } finally { Pop-Location }
    Verify-Login 'admin' $originalPassword $false
    Verify-Login 'operator' 'Fixture second password' $true
    $quotedPass = 'Fixture "quoted" %&! with trailing slash\'
    & $installer -CredentialsOnly -User operator -Pass $quotedPass
    if ($LASTEXITCODE -ne 0) { throw 'PowerShell credential rotation with special characters failed.' }
    Verify-Login 'operator' $quotedPass $true
    if ((Get-JibasHealth $port).pid -ne $upgraded.pid) { throw 'Credential rotation restarted the gateway.' }
    & (Join-Path $stage '.runtime\node\node.exe') (Join-Path $stagedDeployment 'test-bridge.js')
    if ($LASTEXITCODE -ne 0) { throw 'Transactional JIBAS fixture failed.' }
    & $psExe -NoProfile -ExecutionPolicy Bypass -File $uninstaller
    if ($LASTEXITCODE -ne 0 -or (Get-JibasScm $name) -or @(Get-JibasPortOwners $port).Count -gt 0) { throw 'Uninstall did not release the service/socket.' }
    foreach ($file in @('config.json','dashboard-auth.json','sessions','daemon\logs')) {
        if (!(Test-Path -LiteralPath (Join-Path $stage $file))) { throw "Uninstall removed data: $file" }
    }
    & (Join-Path $stage '.runtime\node\node.exe') (Join-Path $stagedDeployment 'test-jibas-e2e.js')
    if ($LASTEXITCODE -ne 0) { throw 'End-to-end JIBAS message fixture failed.' }
    Write-Output "PASS: clean install, port ownership, repair PID $($before.pid) -> $($after.pid), legacy SCM migration, sessions, password-file rotation, JIBAS MOVE, uninstall."
} finally {
    $listener.Stop()
    $env:PATH=$oldPath; $env:NPM_CONFIG_GIT=$oldGit
    Remove-Item Env:FIXTURE_URL,Env:FIXTURE_USER,Env:FIXTURE_PASSWORD,Env:FIXTURE_EXPECTED -ErrorAction SilentlyContinue
    if ((Test-Path -LiteralPath $manager) -and ((Get-JibasScm $name) -or (Get-JibasScm $legacyName))) {
        & $psExe -NoProfile -ExecutionPolicy Bypass -File $manager -Action Uninstall
    }
    foreach ($source in @($name,$legacyName)) {
        if ([Diagnostics.EventLog]::SourceExists($source)) { Remove-EventLog -Source $source }
    }
    if (!(Get-JibasScm $name) -and !(Get-JibasScm $legacyName) -and (Test-Path -LiteralPath $stage) -and $stage.EndsWith("jibas wg service test $stamp")) {
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
}
