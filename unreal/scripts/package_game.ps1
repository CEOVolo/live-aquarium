# Собрать игру пробы в .exe: компиляция, cook контента, упаковка в pak.
#   powershell -File unreal/scripts/package_game.ps1 [-Config Development|Shipping] [-Out D:\Dev\Аквариум\Builds]
# Результат: <Out>\Windows\LiveAquarium.exe. Нужны Build Tools VS 2022 17.14 (MSVC 14.44) и .NET Framework SDK 4.8.1.
# Редактор на время сборки лучше закрыть (cook запускает свой экземпляр движка).
param([ValidateSet("Development", "Shipping")][string]$Config = "Development",
      [string]$Out = "D:\Dev\Аквариум\Builds",
      [string]$Engine = $(if ($env:UE_ROOT) { $env:UE_ROOT } else { "D:\UE\UE_5.8" }))
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Join-Path $here "..\LiveAquarium\LiveAquarium.uproject" | Resolve-Path
if ("$project" -match '[^\x00-\x7F]') {
    # MSVC получает такие пути искажёнными (D:/Dev/РђРєРІ...) — сборка C++ падает
    "Project path has non-ASCII characters: $project"
    "Create an ASCII junction and run the script from it, e.g.:"
    "  New-Item -ItemType Junction -Path D:\Dev\live-aquarium -Target <repo folder>"
    "  powershell -File D:\Dev\live-aquarium\unreal\scripts\package_game.ps1"
    exit 1
}
$started = Get-Date
& (Join-Path $Engine "Engine\Build\BatchFiles\RunUAT.bat") BuildCookRun "-project=$project" -noP4 -utf8output -unattended `
    -platform=Win64 "-clientconfig=$Config" -build -cook -stage -pak -compressed -archive "-archivedirectory=$Out" `
    "-map=/Game/LookTest/Maps/Reef"
$code = $LASTEXITCODE
$exe = Join-Path $Out "Windows\LiveAquarium.exe"
"exit $code, {0:N0} min, exe: {1}" -f ((Get-Date) - $started).TotalMinutes, $(if (Test-Path $exe) { $exe } else { "not found" })
exit $code
