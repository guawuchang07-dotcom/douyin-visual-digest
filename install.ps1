param(
    [string]$DestinationRoot
)

$ErrorActionPreference = "Stop"
$Source = Join-Path $PSScriptRoot "skill\douyin-visual-digest"
if (-not (Test-Path -LiteralPath (Join-Path $Source "SKILL.md"))) {
    throw "找不到 Skill 源目录：$Source"
}

if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
    $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
    $DestinationRoot = Join-Path $CodexHome "skills"
}

$DestinationRoot = [System.IO.Path]::GetFullPath($DestinationRoot)
$Target = Join-Path $DestinationRoot "douyin-visual-digest"
if (Test-Path -LiteralPath $Target) {
    throw "目标 Skill 已存在：$Target。请先备份或移走旧版本后再安装。"
}

New-Item -ItemType Directory -Force -Path $Target | Out-Null
$excludedDirectories = @('.runtime', 'outputs', 'node_modules')
Get-ChildItem -Force -LiteralPath $Source | Where-Object {
    $_.Name -notin $excludedDirectories -and
    $_.Name -ne '.env' -and
    (-not $_.Name.StartsWith('.env.') -or $_.Name -eq '.env.example')
} | Copy-Item -Destination $Target -Recurse -Force

Write-Output "INSTALL_STATUS=ready"
Write-Output "SKILL_PATH=$Target"
Write-Output "下一步：新建一个 Codex 对话，发送‘使用 `$douyin-visual-digest，帮我完成首次配置。’"
