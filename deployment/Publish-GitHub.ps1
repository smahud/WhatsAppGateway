param(
    [string]$PatFile = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'github.pat.json'),
    [string]$Message = 'Harden WAGW JIBAS deployment and add VPS installer',
    [ValidatePattern('^[A-Za-z0-9_.-]+$')]
    [string]$Repository = 'WhatsAppGateway',
    [switch]$AllowPublic,
    [switch]$CreatePrivateRepository
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$wgRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $wgRoot
$wgOwner = 'smahud'
$wgRepository = $Repository
$wgUrl = "https://github.com/$wgOwner/$wgRepository.git"
function Invoke-WgGit {
    param([string[]]$GitArguments)
    & git @GitArguments
    if ($LASTEXITCODE -ne 0) { throw 'Git command failed; no force push is attempted.' }
}
$wgToken = $null
$wgSavedEnv = @{}
try {
    $wgCredentials = Get-Content -LiteralPath $PatFile -Raw | ConvertFrom-Json
    $wgToken = $wgCredentials.smahud
    if ($wgToken -isnot [string] -or [string]::IsNullOrWhiteSpace($wgToken)) { throw 'Missing smahud PAT.' }
    $wgHeaders = @{ Authorization = 'Bearer ' + $wgToken; Accept = 'application/vnd.github+json'; 'User-Agent' = 'WAGW-Deployment' }
    $wgUser = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $wgHeaders
    if ($wgUser.login -ne $wgOwner) { throw 'PAT does not belong to smahud; publishing stopped.' }
    $wgRemotes = @(& git remote)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Git remotes.' }
    $wgHasOrigin = $wgRemotes -contains 'origin'
    if ($wgHasOrigin) {
        $wgRemote = & git remote get-url origin
        if ($LASTEXITCODE -ne 0 -or $wgRemote -ne $wgUrl) { throw 'Origin differs from requested destination; review it manually.' }
    }
    $wgRepo = $null
    try { $wgRepo = Invoke-RestMethod -Uri "https://api.github.com/repos/$wgOwner/$wgRepository" -Headers $wgHeaders }
    catch {
        if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 404) { throw }
    }
    if ($wgRepo -and -not $wgRepo.private -and -not $AllowPublic) { throw 'Existing repo is public. Review contents and use -AllowPublic only if publishing publicly is intended.' }
    if (-not $wgRepo -and -not $CreatePrivateRepository) { throw 'Repository not found or PAT lacks access. Check -Repository and PAT permissions; no repository was created.' }
    $wgBranch = & git branch --show-current
    if ($LASTEXITCODE -ne 0 -or $wgBranch -ne 'main') { throw 'Expected local main branch; no branch changes are made.' }
    $wgCandidates = @(& git -c core.quotepath=false ls-files --cached --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Git candidate files.' }
    $wgSecrets = @($wgCredentials.PSObject.Properties | Where-Object { $_.Value -is [string] -and $_.Value.Length -gt 10 } | ForEach-Object { $_.Value })
    if (Test-Path -LiteralPath config.json) {
        $wgDbPassword = (Get-Content -LiteralPath config.json -Raw | ConvertFrom-Json).password
        if ($wgDbPassword) { $wgSecrets += $wgDbPassword }
    }
    foreach ($wgFile in $wgCandidates) {
        if ($wgFile -match '(^|/)(config\.json|sessions|node_modules|\.git|dist)(/|$)|\.(sqlite|db|log|pid|bak)$|(^|/)[^/]*_log\.txt$|(^|/)github\.pat\.json$|deployment/last-test\.json$|(^|/)node\.exe$') { throw "Sensitive/runtime file would be published: $wgFile" }
        $wgPath = Join-Path $wgRoot $wgFile
        if (-not (Test-Path -LiteralPath $wgPath -PathType Leaf)) { continue }
        $wgContent = [System.IO.File]::ReadAllText($wgPath)
        foreach ($wgSecret in $wgSecrets) { if ($wgContent.Contains($wgSecret)) { throw "Credential detected in candidate file: $wgFile" } }
    }
    Invoke-WgGit -GitArguments @('diff','--check')
    Invoke-WgGit -GitArguments @('add','--all')
    & git diff --cached --quiet
    if ($LASTEXITCODE -eq 1) { Invoke-WgGit -GitArguments @('commit','-m',$Message) }
    elseif ($LASTEXITCODE -ne 0) { throw 'Cannot inspect staged changes.' }
    if (-not $wgRepo) {
        $wgBody = @{name=$wgRepository;private=$true;description='WAGW WhatsApp gateway with transactional JIBAS outbox move integration'} | ConvertTo-Json
        $wgRepo = Invoke-RestMethod -Uri 'https://api.github.com/user/repos' -Headers $wgHeaders -Method Post -ContentType 'application/json' -Body $wgBody
    }
    if ($wgRepo.full_name -ne "$wgOwner/$wgRepository") { throw 'Unexpected repository returned by GitHub.' }
    if (-not $wgHasOrigin) { Invoke-WgGit -GitArguments @('remote','add','origin',$wgUrl) }
    # Process-local header only: never put PAT in origin, a file, or git arguments.
    $wgEnvValues = @{
        GIT_CONFIG_COUNT='1';
        GIT_CONFIG_KEY_0='http.https://github.com/.extraheader';
        GIT_CONFIG_VALUE_0=('AUTHORIZATION: basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('x-access-token:' + $wgToken)));
        GIT_TERMINAL_PROMPT='0'; GIT_TRACE='0'; GIT_TRACE_CURL='0'; GIT_CURL_VERBOSE='0'
    }
    foreach ($wgName in $wgEnvValues.Keys) {
        $wgSavedEnv[$wgName] = [Environment]::GetEnvironmentVariable($wgName,'Process')
        [Environment]::SetEnvironmentVariable($wgName,$wgEnvValues[$wgName],'Process')
    }
    Invoke-WgGit -GitArguments @('-c','credential.helper=','push','-u','origin','main')
    Write-Output "Published: https://github.com/$wgOwner/$wgRepository"
    Invoke-WgGit -GitArguments @('log','-1','--format=%h %s')
    Invoke-WgGit -GitArguments @('status','--short')
} catch {
    $wgFailure = $_.Exception.Message
    if ($wgToken) { $wgFailure = $wgFailure.Replace($wgToken,'[REDACTED]') }
    Write-Output "Publishing stopped: $wgFailure"
    exit 1
} finally {
    foreach ($wgName in $wgSavedEnv.Keys) { [Environment]::SetEnvironmentVariable($wgName,$wgSavedEnv[$wgName],'Process') }
    $wgToken = $null
    $wgCredentials = $null
}
