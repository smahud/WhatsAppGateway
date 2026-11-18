param(
    [string]$PatFile = (Join-Path (Split-Path -Parent $PSScriptRoot) 'github.pat.txt'),
    [switch]$AllowPublic,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot
$owner = 'smahud'
$repository = 'WhatsAppGateway' # Existing remote; keep its public URL and history.
$url = "https://github.com/$owner/$repository.git"
$token = $null
$saved = @{}
$locationSet = $false
$privatePath = '(?i)(^|/)(config\.json|dashboard-auth\.json|github\.pat(?:\.[^/]+)?|\.env(?:\.[^/]+)?|sessions|node_modules|daemon|\.runtime|\.git|dist|node\.exe)(/|$)|\.(sqlite|db)(?:-[^/]*)?$|\.(log|pid|bak|install-tmp|htpasswd|key|pem|pfx|pass)$|(^|/)[^/]*_log\.txt$|(^|/)last-test\.json$'

function Invoke-GitChecked([string[]]$GitArguments) {
    & git @GitArguments
    if ($LASTEXITCODE -ne 0) { throw 'Git command failed; no force push is attempted.' }
}

try {
    $PatFile = (Resolve-Path -LiteralPath $PatFile).Path
    Push-Location -LiteralPath $root
    $locationSet = $true
    if ((Invoke-GitChecked @('branch','--show-current')) -ne 'main') { throw 'Expected local main.' }
    $raw = [IO.File]::ReadAllText($PatFile)
    # Accept a raw PAT or a text file containing one labeled PAT. Never print the file.
    $tokens = @([regex]::Matches($raw, '(?<![A-Za-z0-9_])(?:github_pat_[A-Za-z0-9_]{30,}|ghp_[A-Za-z0-9]{30,}|[0-9a-fA-F]{40})(?![A-Za-z0-9_])') |
        Select-Object -ExpandProperty Value -Unique)
    if ($tokens.Count -ne 1) { throw 'Expected exactly one GitHub PAT in the supplied file.' }
    $token = $tokens[0]
    $headers = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'JIBAS-WG' }
    $user = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers -TimeoutSec 30
    if ($user.login -ne $owner) { throw "PAT does not belong to $owner." }
    $repo = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repository" -Headers $headers -TimeoutSec 30
    if ($repo.full_name -cne "$owner/$repository" -or $repo.archived -or !$repo.permissions.push) { throw 'Repository is not a verified writable destination.' }
    if (!$repo.private -and !$AllowPublic) { throw 'Repository is public. Review the commit and pass -AllowPublic to publish.' }
    $oldUrl = @((Invoke-GitChecked @('remote')) | Where-Object { $_ -eq 'origin' })
    if ($oldUrl -and ((Invoke-GitChecked @('remote','get-url','origin')) -ne $url -or
          (Invoke-GitChecked @('remote','get-url','--push','origin')) -ne $url)) {
        throw 'Origin or its push URL differs from the verified destination.'
    }

    $extraHeaders = @(& git config --name-only --get-regexp '^http(\..*)?\.extraheader$')
    if ($LASTEXITCODE -notin 0,1 -or $extraHeaders.Count) { throw 'Git already has HTTP extra headers configured; review them before publishing.' }
    $envValues = @{
        GIT_CONFIG_COUNT='1';
        GIT_CONFIG_KEY_0='http.https://github.com/.extraheader';
        GIT_CONFIG_VALUE_0=('Authorization: Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("x-access-token:$token")));
        GIT_TERMINAL_PROMPT='0'; GIT_TRACE=$null; GIT_TRACE_CURL=$null; GIT_CURL_VERBOSE=$null;
        GIT_TRACE2=$null; GIT_TRACE2_EVENT=$null; GIT_TRACE2_PERF=$null; GIT_TRACE_PACKET=$null;
        GIT_TRACE_REDACT='1'
    }
    foreach ($key in $envValues.Keys) {
        $saved[$key] = [Environment]::GetEnvironmentVariable($key,'Process')
        [Environment]::SetEnvironmentVariable($key,$envValues[$key],'Process')
    }
    $transport = @('-c','credential.helper=','-c','http.followRedirects=false')
    Invoke-GitChecked ($transport + @('fetch','--no-tags',$url,'refs/heads/main'))
    $head = Invoke-GitChecked @('rev-parse','HEAD')
    $upstream = Invoke-GitChecked @('rev-parse','FETCH_HEAD')
    & git merge-base --is-ancestor $upstream $head
    if ($LASTEXITCODE -ne 0) { throw 'Remote main is not an ancestor. Reconcile history before publishing.' }
    $secrets = @($token)
    if (Test-Path -LiteralPath (Join-Path $root 'config.json')) {
        try { $dbPassword = (Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json).password }
        catch { throw 'Cannot safely parse local config.json to check for leaked credentials.' }
        if ($dbPassword) { $secrets += [string]$dbPassword }
    }
    $commits = @($head; Invoke-GitChecked @('rev-list',"$upstream..$head")) | Sort-Object -Unique
    foreach ($commit in $commits) {
        $paths = Invoke-GitChecked @('-c','core.quotepath=false','ls-tree','--full-tree','-r','--name-only',$commit)
        foreach ($file in $paths) {
            if ($file -match $privatePath) { throw "Sensitive/runtime path in commit: $file" }
            $content = (Invoke-GitChecked @('show',"${commit}:$file")) -join "`n"
            foreach ($secret in $secrets) {
                if ($content.Contains($secret)) { throw "Credential detected in commit: $file" }
            }
        }
    }
    if ($CheckOnly) { Write-Output "Verified fast-forward destination and source-only commit: $head"; exit 0 }
    if (!$oldUrl) { Invoke-GitChecked @('remote','add','origin',$url) }
    Invoke-GitChecked ($transport + @('push','-u','origin','HEAD:refs/heads/main'))
    $remote = Invoke-GitChecked ($transport + @('ls-remote','--exit-code','origin','refs/heads/main'))
    if (($remote -split '\s+')[0] -ne $head) { throw 'The remote branch did not report the expected commit.' }
    Write-Output "Published: https://github.com/$owner/$repository/commit/$head"
} catch {
    $detail = $_.Exception.Message
    if ($token) { $detail = $detail.Replace($token,'[REDACTED]') }
    [Console]::Error.WriteLine("Publishing stopped: $detail")
    exit 1
} finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key,$saved[$key],'Process') }
    if ($locationSet) { Pop-Location }
}
