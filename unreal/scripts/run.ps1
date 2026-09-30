# Запуск Python-скрипта без окна редактора (commandlet, без рендера) и вывод строк LOOKTEST / ошибок.
# Для импорта и сборки, когда редактор закрыт. В открытом редакторе — ue_remote.py.
#   powershell -File unreal/scripts/run.ps1 import_fish.py
param(
    [Parameter(Mandatory = $true)][string]$Script,
    [string]$Engine = $(if ($env:UE_ROOT) { $env:UE_ROOT } else { "D:\UE\UE_5.8" })
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Join-Path $here "..\LiveAquarium\LiveAquarium.uproject" | Resolve-Path
$scriptPath = if (Test-Path $Script) { Resolve-Path $Script } else { Join-Path $here $Script | Resolve-Path }
$log = Join-Path (Split-Path $project) "Saved\Logs\LiveAquarium.log"

$started = Get-Date
& (Join-Path $Engine "Engine\Binaries\Win64\UnrealEditor-Cmd.exe") $project -run=pythonscript "-script=$scriptPath" -unattended -nosplash -nullrhi 2>&1 | Out-Null
$code = $LASTEXITCODE
Select-String -Path $log -CaseSensitive -Pattern 'LOOKTEST|LogPython: Error|Fatal error|Assertion failed' |
    ForEach-Object { $_.Line -replace '^\[.*?\]\[.*?\]LogPython: ', '' }
"exit {0}, {1:N0}s" -f $code, ((Get-Date) - $started).TotalSeconds
