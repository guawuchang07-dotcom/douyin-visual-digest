param(
    [string]$InputText,
    [string]$MediaPath,
    [string]$OutDir,
    [ValidateSet("tiny", "base")]
    [string]$ModelName = "base",
    [int]$Threads = 0,
    [switch]$KeepAudio
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root ".runtime"
$Dyt = Join-Path $Root "vendor\dyt.exe"
$AcquireScript = Join-Path $PSScriptRoot "acquire-douyin.mjs"
$PlaywrightCore = Join-Path $Root "node_modules\playwright-core"
$WhisperCli = Get-ChildItem -LiteralPath (Join-Path $Runtime "whisper") -Recurse -Filter "whisper-cli.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
$ModelPath = Join-Path $Runtime "models\ggml-$ModelName.bin"

if ([string]::IsNullOrWhiteSpace($InputText) -and [string]::IsNullOrWhiteSpace($MediaPath)) {
    throw "请提供抖音分享链接，或使用 -MediaPath 指定本地视频/音频。"
}
if (-not [string]::IsNullOrWhiteSpace($InputText) -and $InputText -notmatch "douyin\.com/") {
    throw "输入内容中没有找到抖音链接。"
}
if ([string]::IsNullOrWhiteSpace($WhisperCli) -or -not (Test-Path -LiteralPath $ModelPath)) {
    throw "本地转写运行时未安装完整。请先运行：.\scripts\setup.ps1 -ModelName $ModelName"
}
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    throw "找不到 ffmpeg。请先运行 .\scripts\setup.ps1，或手动安装 ffmpeg。"
}

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $Root "outputs"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outFile = Join-Path $OutDir "douyin-transcript-$stamp-$ModelName.txt"
$sourceMode = ""
$sourceDetail = ""
$sourceUrl = ""
$sourceTitle = ""
$chaptersPath = ""
$downloadedMedia = ""
$diagnostics = [System.Collections.Generic.List[string]]::new()

function Invoke-NativeCaptured {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $lines = @(& $FilePath @Arguments 2>&1 | ForEach-Object { "$_" })
        $exitCode = $LASTEXITCODE
        return [pscustomobject]@{ ExitCode = $exitCode; Lines = $lines; Text = ($lines -join "`n") }
    } finally {
        $ErrorActionPreference = $previousPreference
    }
}

function Convert-MediaToTranscript {
    param([Parameter(Mandatory = $true)][string]$SourceMedia)

    $resolvedMedia = [System.IO.Path]::GetFullPath($SourceMedia)
    if (-not (Test-Path -LiteralPath $resolvedMedia)) {
        throw "本地媒体文件不存在：$resolvedMedia"
    }
    $wavPath = Join-Path $OutDir "source-audio-$stamp.wav"
    $ffmpegArgs = @("-y", "-i", $resolvedMedia, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", $wavPath)
    $ffmpegResult = Invoke-NativeCaptured -FilePath "ffmpeg" -Arguments $ffmpegArgs
    if ($ffmpegResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $wavPath)) {
        throw "FFmpeg 提取音频失败，退出码：$($ffmpegResult.ExitCode)"
    }

    $prefix = Join-Path $OutDir "whisper-$stamp-$ModelName"
    $whisperArgs = @("-m", $ModelPath, "-f", $wavPath, "-l", "zh", "-otxt", "-of", $prefix)
    if ($Threads -gt 0) { $whisperArgs += @("-t", "$Threads") }
    $whisperResult = Invoke-NativeCaptured -FilePath $WhisperCli -Arguments $whisperArgs
    $whisperText = "$prefix.txt"
    if ($whisperResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $whisperText)) {
        throw "Whisper 转写失败，退出码：$($whisperResult.ExitCode)"
    }
    Move-Item -LiteralPath $whisperText -Destination $outFile -Force
    if (-not $KeepAudio) { Remove-Item -LiteralPath $wavPath -Force -ErrorAction SilentlyContinue }
}

function Try-LegacyDyt {
    if (-not (Test-Path -LiteralPath $Dyt)) { return $false }
    $env:PATH = "$(Split-Path -Parent $WhisperCli);$env:PATH"
    $arguments = @("--local", "--model-path", $ModelPath, "-l", "zh", "-o", $outFile)
    if ($Threads -gt 0) { $arguments += @("-t", "$Threads") }
    if ($KeepAudio) { $arguments += "--keep-audio" }
    $arguments += $InputText
    $result = Invoke-NativeCaptured -FilePath $Dyt -Arguments $arguments
    if ($result.ExitCode -eq 0 -and (Test-Path -LiteralPath $outFile)) { return $true }
    $diagnostics.Add("legacy-dyt exit=$($result.ExitCode)")
    return $false
}

if (-not [string]::IsNullOrWhiteSpace($MediaPath)) {
    Convert-MediaToTranscript -SourceMedia $MediaPath
    $sourceMode = "provided-media"
    $sourceDetail = "local-audio-asr"
} else {
    $browserReady = (Test-Path -LiteralPath $AcquireScript) -and (Test-Path -LiteralPath $PlaywrightCore) -and [bool](Get-Command node -ErrorAction SilentlyContinue)
    if ($browserReady) {
        $acquireDir = Join-Path $OutDir "acquisition"
        $acquireArgs = @($AcquireScript, "--input", $InputText, "--out-dir", $acquireDir)
        $savedNodeProxy = $env:NODE_USE_ENV_PROXY
        Remove-Item Env:NODE_USE_ENV_PROXY -ErrorAction SilentlyContinue
        try {
            $acquireResult = Invoke-NativeCaptured -FilePath "node" -Arguments $acquireArgs
        } finally {
            if ($null -ne $savedNodeProxy) { $env:NODE_USE_ENV_PROXY = $savedNodeProxy }
        }
        if ($acquireResult.ExitCode -eq 0) {
            $markers = @{}
            foreach ($line in $acquireResult.Lines) {
                if ($line -match '^([A-Z_]+)=(.*)$') { $markers[$matches[1]] = $matches[2].Trim() }
            }
            $metadataPath = if ($markers["METADATA_FILE"]) { $markers["METADATA_FILE"] } else { Join-Path $acquireDir "acquisition.json" }
            $metadata = $null
            if (Test-Path -LiteralPath $metadataPath) {
                try { $metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $metadata = $null }
            }
            $sourceUrl = $markers["SOURCE_URL"]
            $sourceTitle = $markers["SOURCE_TITLE"]
            $chaptersPath = $markers["CHAPTERS_FILE"]
            $downloadedMedia = $markers["MEDIA_FILE"]
            if ($metadata) {
                if ($metadata.resolvedUrl) { $sourceUrl = $metadata.resolvedUrl }
                if ($metadata.title) { $sourceTitle = $metadata.title }
                if ($metadata.chaptersPath) { $chaptersPath = $metadata.chaptersPath }
                if ($metadata.mediaPath) { $downloadedMedia = $metadata.mediaPath }
            }
            if (-not $downloadedMedia -or -not (Test-Path -LiteralPath $downloadedMedia)) {
                $diagnostics.Add("browser-acquire returned no usable media file")
            }
            if ($downloadedMedia -and (Test-Path -LiteralPath $downloadedMedia)) {
                try {
                    Convert-MediaToTranscript -SourceMedia $downloadedMedia
                    $sourceMode = "audio-asr"
                    $sourceDetail = "browser-media"
                } catch {
                    $diagnostics.Add("browser-media-asr failed: $($_.Exception.Message)")
                    Start-Sleep -Milliseconds 500
                    try {
                        Convert-MediaToTranscript -SourceMedia $downloadedMedia
                        $sourceMode = "audio-asr"
                        $sourceDetail = "browser-media-retry"
                    } catch {
                        $diagnostics.Add("browser-media-asr retry failed: $($_.Exception.Message)")
                    }
                }
            }
        } else {
            $errorLine = $acquireResult.Lines | Where-Object { $_ -match '^ERROR=' } | Select-Object -Last 1
            $errorSuffix = if ($errorLine) { ": $errorLine" } else { "" }
            $diagnostics.Add("browser-acquire exit=$($acquireResult.ExitCode)$errorSuffix")
        }
    } else {
        $diagnostics.Add("browser-acquire unavailable")
    }

    if (-not (Test-Path -LiteralPath $outFile) -and (Try-LegacyDyt)) {
        $sourceMode = "audio-asr"
        $sourceDetail = "legacy-dyt"
    }

    if (-not (Test-Path -LiteralPath $outFile) -and $chaptersPath -and (Test-Path -LiteralPath $chaptersPath)) {
        Copy-Item -LiteralPath $chaptersPath -Destination $outFile -Force
        $sourceMode = "page-chapters"
        $sourceDetail = "douyin-chapter-summary"
    }
}

if (-not (Test-Path -LiteralPath $outFile)) {
    $detail = if ($diagnostics.Count) { "（$($diagnostics -join '；')）" } else { "" }
    throw "无法获取或转写该视频。请确认链接有效，或提供本地视频文件。$detail"
}

if (-not $KeepAudio -and $downloadedMedia -and (Test-Path -LiteralPath $downloadedMedia)) {
    Remove-Item -LiteralPath $downloadedMedia -Force -ErrorAction SilentlyContinue
}

Write-Output "SOURCE_MODE=$sourceMode"
Write-Output "SOURCE_DETAIL=$sourceDetail"
Write-Output "SOURCE_URL=$sourceUrl"
Write-Output "SOURCE_TITLE=$sourceTitle"
if ($sourceMode -eq "page-chapters" -and $diagnostics.Count) {
    Write-Output "SOURCE_WARNING=$($diagnostics -join '；')"
}
Write-Output "Transcript saved to: $outFile"
