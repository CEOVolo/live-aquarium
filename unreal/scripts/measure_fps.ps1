# Замер FPS в реальном времени: уровень пробы как игра (-game) 1920x1080 с камеры стрима Cam_Wide (-streamview),
# время кадров — CSV-профайлер движка; сводка — fps_report.py (первые кадры прогрева отбрасываются).
#   powershell -File unreal/scripts/measure_fps.ps1 [-Frames 1800] [-Skip 600]
# Для чистого замера редактор лучше закрыть: он делит с игрой видеокарту.
param([int]$Frames = 1800, [int]$Skip = 600,
      [string]$Engine = $(if ($env:UE_ROOT) { $env:UE_ROOT } else { "D:\UE\UE_5.8" }))
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Join-Path $here "..\LiveAquarium\LiveAquarium.uproject" | Resolve-Path
# -game из редакторной сборки пишет CSV в пользовательскую папку движка, не в проект
$csvDirs = @((Join-Path (Split-Path $project) "Saved\Profiling\CSV"),
             (Join-Path $env:LOCALAPPDATA ("UnrealEngine\" + (Split-Path $Engine -Leaf).Replace("UE_", "") + "\Saved\Profiling\CSV")))
$before = @($csvDirs | ForEach-Object { Get-ChildItem $_ -Filter *.csv -ErrorAction SilentlyContinue } | ForEach-Object FullName)

# UnrealEditor.exe -game через Start-Process сразу выходит; -Cmd работает (окно игры открывается).
# -ResX/-ResY перебивает сохранённый GameUserSettings (1280x720) — разрешение задаём командой r.SetRes,
# масштаб рендера — 100% (без апскейла).
& (Join-Path $Engine "Engine\Binaries\Win64\UnrealEditor-Cmd.exe") $project "/Game/LookTest/Maps/Reef" -game -windowed `
    -nosplash -nosound -streamview "-ExecCmds=r.SetRes 1920x1080w,r.ScreenPercentage 100" `
    "-csvCaptureFrames=$Frames" -ExitAfterCsvProfiling 2>&1 | Out-Null

$csv = $csvDirs | ForEach-Object { Get-ChildItem $_ -Filter *.csv -ErrorAction SilentlyContinue } |
    Where-Object { $before -notcontains $_.FullName } | Sort-Object LastWriteTime | Select-Object -Last 1
if (-not $csv) { "no CSV written"; exit 1 }
$csv.FullName
python (Join-Path $here "fps_report.py") $csv.FullName $Skip
