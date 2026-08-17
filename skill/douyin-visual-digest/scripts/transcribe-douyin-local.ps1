param(
    [Parameter(Mandatory = $true)]
    [string]$InputText,
    [string]$OutDir,
    [ValidateSet("tiny", "base")]
    [string]$ModelName = "base",
    [int]$Threads = 0,
    [switch]$KeepAudio
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root ".runtime"
$Dyt = Join-Path $Root "vendor\dyt.exe"
$WhisperCli = Get-ChildItem -LiteralPath (Join-Path $Runtime "whisper") -Recurse -Filter "whisper-cli.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
$ModelPath = Join-Path $Runtime "models\ggml-$ModelName.bin"

if ($InputText -notmatch "douyin\.com/") {
    throw "输入内容中没有找到抖音链接。"
}
if (-not (Test-Path -LiteralPath $Dyt)) {
    throw "缺少 vendor\dyt.exe。请重新下载完整仓库。"
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
$env:PATH = "$(Split-Path -Parent $WhisperCli);$env:PATH"
$arguments = @("--local", "--model-path", $ModelPath, "-l", "zh", "-o", $outFile)
if ($Threads -gt 0) { $arguments += @("-t", "$Threads") }
if ($KeepAudio) { $arguments += "--keep-audio" }
$arguments += $InputText

& $Dyt @arguments
if ($LASTEXITCODE -ne 0) {
    throw "dyt 转写失败，退出码：$LASTEXITCODE"
}
if (-not (Test-Path -LiteralPath $outFile)) {
    throw "转写完成后没有生成输出文件：$outFile"
}
Write-Output "Transcript saved to: $outFile"

