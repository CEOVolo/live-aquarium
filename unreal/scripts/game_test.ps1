# Проверка собранной игры без рук: автопилот (рыба плывёт кругом у рифа, акула замечает её),
# время кадров — CSV-профайлер, 4 снимка экрана. Сводка — fps_report.py.
#   powershell -File unreal/scripts/game_test.ps1 [-Frames 2400] [-Skip 300] [-Out D:\Dev\Аквариум\Builds]
param([int]$Frames = 2400, [int]$Skip = 300, [string]$Out = "D:\Dev\Аквариум\Builds")
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$game = Join-Path $Out "Windows"
$exe = Join-Path $game "LiveAquarium.exe"
if (-not (Test-Path $exe)) { "no game at $exe — run package_game.ps1"; exit 1 }
$saved = Join-Path $game "LiveAquarium\Saved"
$csvDir = Join-Path $saved "Profiling\CSV"
$shots = Join-Path $saved "Screenshots\Windows"
$before = @(Get-ChildItem $csvDir -Filter *.csv -ErrorAction SilentlyContinue | ForEach-Object FullName)
Remove-Item (Join-Path $shots "autopilot_*") -ErrorAction SilentlyContinue

$p = Start-Process $exe -PassThru -ArgumentList @("-autopilot", "-autopilotseconds=120", "-nosound",
    "-csvCaptureFrames=$Frames", "-ExitAfterCsvProfiling")
$p.WaitForExit(600000) | Out-Null
if (-not $p.HasExited) { $p.Kill(); "game did not exit in 10 min" }

$csv = Get-ChildItem $csvDir -Filter *.csv -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.FullName } |
    Sort-Object LastWriteTime | Select-Object -Last 1
if ($csv) { python (Join-Path $here "fps_report.py") $csv.FullName $Skip } else { "no CSV written" }
Get-ChildItem $shots -Filter "autopilot_*" -ErrorAction SilentlyContinue | ForEach-Object FullName
$log = Join-Path $saved "Logs\LiveAquarium.log"
if (Test-Path $log) {
    Select-String -Path $log -Pattern 'LogAquarium|Error:|Fatal' | Select-Object -First 20 | ForEach-Object { $_.Line }
}
