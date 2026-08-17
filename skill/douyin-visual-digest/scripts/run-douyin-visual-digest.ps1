param(
    [string]$InputText,
    [switch]$FromClipboard,
    [string]$Transcript,
    [string]$MediaFile,
    [string]$AnalysisFile,
    [string]$OutDir,
    [string]$EnvFile,
    [ValidateSet("api", "none")]
    [string]$ImageMode = "api",
    [ValidateSet("tiny", "base")]
    [string]$ModelName = "base",
    [string]$Title,
    [switch]$DryRun,
    [switch]$LocalAnalysis,
    [switch]$TestImageApi,
    [switch]$TestTextApi,
    [switch]$TranscriptOnly
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Cli = Join-Path $PSScriptRoot "douyin-visual-digest.mjs"

function Enable-NodeSystemProxy {
    $configPath = if ([string]::IsNullOrWhiteSpace($EnvFile)) { Join-Path $Root ".env" } else { $EnvFile }
    $probeUrls = [System.Collections.Generic.List[string]]::new()
    if (Test-Path -LiteralPath $configPath) {
        foreach ($line in Get-Content -LiteralPath $configPath -Encoding UTF8) {
            if ($line -match '^(IMAGE_API_BASE_URL|LCONAI_BASE_URL|TEXT_API_BASE_URL)=(https?://.+)$') {
                $probeUrls.Add($matches[2].Trim())
            }
        }
    }
    $probeUrls.Add("https://example.com")

    $noProxyEntries = @($env:NO_PROXY -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $noProxyEntries += @("localhost", "127.0.0.1", "::1")
    foreach ($probeUrl in $probeUrls) {
        try {
            $probeHost = ([Uri]$probeUrl).Host
            if ($probeHost -eq "cn.jbbt.cc") { $noProxyEntries += $probeHost }
        } catch {
            continue
        }
    }
    $env:NO_PROXY = ($noProxyEntries | Select-Object -Unique) -join ','

    if ($env:HTTPS_PROXY -or $env:HTTP_PROXY) {
        $env:NODE_USE_ENV_PROXY = "1"
        return
    }

    try {
        $systemProxy = [System.Net.WebRequest]::DefaultWebProxy
        foreach ($probeUrl in $probeUrls) {
            $probeUri = [Uri]$probeUrl
            if ($systemProxy.IsBypassed($probeUri)) { continue }
            $proxyUri = $systemProxy.GetProxy($probeUri)
            if (-not $proxyUri -or $proxyUri.AbsoluteUri -eq $probeUri.AbsoluteUri) { continue }

            $env:HTTPS_PROXY = $proxyUri.AbsoluteUri
            $env:HTTP_PROXY = $proxyUri.AbsoluteUri
            $env:NODE_USE_ENV_PROXY = "1"
            return
        }
    } catch {
        # Direct connection remains available when Windows has no usable proxy.
    }
}

if ($FromClipboard) {
    $InputText = Get-Clipboard -Raw
}

if (-not $TranscriptOnly) {
    Enable-NodeSystemProxy
}

$ArgsList = @($Cli, "--image-mode", $ImageMode, "--model-name", $ModelName)
if (-not [string]::IsNullOrWhiteSpace($InputText)) { $ArgsList += @("--input", $InputText) }
if (-not [string]::IsNullOrWhiteSpace($Transcript)) { $ArgsList += @("--transcript", $Transcript) }
if (-not [string]::IsNullOrWhiteSpace($MediaFile)) { $ArgsList += @("--media-file", $MediaFile) }
if (-not [string]::IsNullOrWhiteSpace($AnalysisFile)) { $ArgsList += @("--analysis-file", $AnalysisFile) }
if (-not [string]::IsNullOrWhiteSpace($OutDir)) { $ArgsList += @("--out-dir", $OutDir) }
if (-not [string]::IsNullOrWhiteSpace($EnvFile)) { $ArgsList += @("--env-file", $EnvFile) }
if (-not [string]::IsNullOrWhiteSpace($Title)) { $ArgsList += @("--title", $Title) }
if ($DryRun) { $ArgsList += "--dry-run" }
if ($LocalAnalysis) { $ArgsList += "--local-analysis" }
if ($TestImageApi) { $ArgsList += "--test-image-api" }
if ($TestTextApi) { $ArgsList += "--test-text-api" }
if ($TranscriptOnly) { $ArgsList += "--transcript-only" }

& node @ArgsList
if ($LASTEXITCODE -ne 0) {
    throw "douyin-visual-digest failed with exit code $LASTEXITCODE"
}
