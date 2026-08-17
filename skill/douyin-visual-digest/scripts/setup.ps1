param(
    [ValidateSet("tiny", "base")]
    [string]$ModelName = "base",
    [string]$WhisperVersion = "v1.9.2",
    [switch]$Force,
    [switch]$SkipFfmpeg,
    [string]$WhisperSourceDir,
    [string]$ModelSourcePath
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root ".runtime"
$WhisperDir = Join-Path $Runtime "whisper"
$ModelsDir = Join-Path $Runtime "models"
$DownloadsDir = Join-Path $Runtime "downloads"
$Dyt = Join-Path $Root "vendor\dyt.exe"
$ModelPath = Join-Path $ModelsDir "ggml-$ModelName.bin"

if (-not [Environment]::Is64BitOperatingSystem) {
    throw "当前公开版只支持 Windows x64。"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "找不到 Node.js。请先安装 Node.js 18 或更高版本：https://nodejs.org/"
}
if (-not (Test-Path -LiteralPath $Dyt)) {
    throw "缺少 vendor\dyt.exe。请确认下载的是完整 GitHub 仓库，而不是单个文件。"
}

if (-not $SkipFfmpeg -and -not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "找不到 ffmpeg，也没有 winget。请先安装 ffmpeg：https://ffmpeg.org/download.html"
    }
    Write-Output "正在通过 winget 安装 ffmpeg..."
    & winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg 安装失败，退出码：$LASTEXITCODE" }
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

New-Item -ItemType Directory -Force -Path $WhisperDir,$ModelsDir,$DownloadsDir | Out-Null
$WhisperCli = Get-ChildItem -LiteralPath $WhisperDir -Recurse -Filter "whisper-cli.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($Force -or -not $WhisperCli) {
    if (Test-Path -LiteralPath $WhisperDir) { Remove-Item -LiteralPath $WhisperDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $WhisperDir | Out-Null
    if (-not [string]::IsNullOrWhiteSpace($WhisperSourceDir)) {
        Get-ChildItem -LiteralPath $WhisperSourceDir -Force | Copy-Item -Destination $WhisperDir -Recurse -Force
    } else {
        $zip = Join-Path $DownloadsDir "whisper-bin-x64-$WhisperVersion.zip"
        $url = "https://github.com/ggml-org/whisper.cpp/releases/download/$WhisperVersion/whisper-bin-x64.zip"
        Write-Output "正在下载 whisper.cpp $WhisperVersion..."
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
        Expand-Archive -LiteralPath $zip -DestinationPath $WhisperDir -Force
    }
}

if ($Force -or -not (Test-Path -LiteralPath $ModelPath)) {
    if (-not [string]::IsNullOrWhiteSpace($ModelSourcePath)) {
        Copy-Item -LiteralPath $ModelSourcePath -Destination $ModelPath -Force
    } else {
        $modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$ModelName.bin"
        Write-Output "正在下载 Whisper $ModelName 模型，这一步文件较大..."
        Invoke-WebRequest -Uri $modelUrl -OutFile $ModelPath -UseBasicParsing
    }
}

$WhisperCli = Get-ChildItem -LiteralPath $WhisperDir -Recurse -Filter "whisper-cli.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
$modelInfo = Get-Item -LiteralPath $ModelPath -ErrorAction SilentlyContinue
if (-not $WhisperCli) { throw "whisper.cpp 下载完成，但没有找到 whisper-cli.exe。" }
if (-not $modelInfo -or $modelInfo.Length -lt 10MB) { throw "Whisper 模型文件无效或下载不完整：$ModelPath" }

Write-Output "SETUP_STATUS=ready"
Write-Output "DYT=$Dyt"
Write-Output "WHISPER=$($WhisperCli.FullName)"
Write-Output "MODEL=$ModelPath"
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { Write-Output "FFMPEG=ready" } else { Write-Output "FFMPEG=missing" }
Write-Output "下一步：运行 .\scripts\doctor.ps1 复查；只有 READY=True 才表示准备完成。"
