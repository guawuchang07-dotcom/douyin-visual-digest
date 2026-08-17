param(
    [ValidateSet("tiny", "base")][string]$ModelName = "base",
    [string]$EnvFile
)

$Root = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $Root ".runtime"
$EnvPath = if ([string]::IsNullOrWhiteSpace($EnvFile)) { Join-Path $Root ".env" } else { [System.IO.Path]::GetFullPath($EnvFile) }
$Whisper = Get-ChildItem -LiteralPath (Join-Path $Runtime "whisper") -Recurse -Filter "whisper-cli.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
$Model = Join-Path $Runtime "models\ggml-$ModelName.bin"
$Dyt = Join-Path $Root "vendor\dyt.exe"
$envValues = @{}
if (Test-Path -LiteralPath $EnvPath) {
    Get-Content -LiteralPath $EnvPath -Encoding UTF8 | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $envValues[$matches[1]] = $matches[2].Trim() }
    }
}
$textBase = $envValues['TEXT_API_BASE_URL']
$textKey = $envValues['TEXT_API_KEY']
$textModel = $envValues['TEXT_MODEL']
$imageBase = if ($envValues['IMAGE_API_BASE_URL']) { $envValues['IMAGE_API_BASE_URL'] } elseif ($envValues['LCONAI_BASE_URL']) { $envValues['LCONAI_BASE_URL'] } elseif ($envValues['AI_API_BASE_URL']) { $envValues['AI_API_BASE_URL'] } else { $envValues['OPENAI_BASE_URL'] }
$imageKey = if ($envValues['IMAGE_API_KEY']) { $envValues['IMAGE_API_KEY'] } elseif ($envValues['LCONAI_API_KEY']) { $envValues['LCONAI_API_KEY'] } elseif ($envValues['AI_API_KEY']) { $envValues['AI_API_KEY'] } else { $envValues['OPENAI_API_KEY'] }
$imageModel = $envValues['IMAGE_MODEL']

$windowsX64 = [Environment]::Is64BitOperatingSystem
$node18Plus = $false
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    $nodeVersion = (& node --version 2>$null)
    if ($nodeVersion -match '^v?(\d+)') { $node18Plus = [int]$matches[1] -ge 18 }
}
$ffmpegReady = [bool](Get-Command ffmpeg -ErrorAction SilentlyContinue)
$dytReady = Test-Path -LiteralPath $Dyt
$whisperReady = [bool]$Whisper
$modelReady = Test-Path -LiteralPath $Model
$imageApiReady = [bool]($imageBase -and $imageKey -and $imageModel)
$missingTools = @()
if (-not $windowsX64) { $missingTools += 'Windows x64' }
if (-not $node18Plus) { $missingTools += 'Node.js 18+' }
if (-not $ffmpegReady) { $missingTools += 'FFmpeg' }
if (-not $dytReady) { $missingTools += 'vendor/dyt.exe' }
if (-not $whisperReady) { $missingTools += 'whisper-cli.exe' }
if (-not $modelReady) { $missingTools += "Whisper $ModelName model" }
$toolsReady = $missingTools.Count -eq 0
$ready = $toolsReady -and $imageApiReady

[pscustomobject]@{
    WindowsX64 = $windowsX64
    Node18Plus = $node18Plus
    Ffmpeg = $ffmpegReady
    Dyt = $dytReady
    Whisper = $whisperReady
    Model = $modelReady
    TextApi = [bool]($textBase -and $textKey -and $textModel)
    ImageApi = $imageApiReady
    ToolsReady = $toolsReady
    Ready = $ready
} | Format-List

Write-Output "MISSING_TOOLS=$($missingTools -join ',')"
Write-Output "TOOLS_READY=$toolsReady"
Write-Output "IMAGE_API_READY=$imageApiReady"
Write-Output "READY=$ready"
