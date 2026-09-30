# Открыть редактор с проектом пробы и дождаться Python Remote Execution.
#   powershell -File unreal/scripts/open_editor.ps1 [-WithSound]
# По умолчанию — без звука (-nosound): на этом ноутбуке живой звуковой поток Unreal
# (Audient EVO4 + Wi-Fi Realtek RTL8852BE) обваливает интернет: скачивание 100 -> 7 Мбит/с,
# отдача -> 0, пока звук открыт (подробности — docs/UNREAL_LOOKTEST.md).
param([switch]$WithSound,
      [string]$Engine = $(if ($env:UE_ROOT) { $env:UE_ROOT } else { "D:\UE\UE_5.8" }))
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Join-Path $here "..\LiveAquarium\LiveAquarium.uproject" | Resolve-Path
$py = Join-Path $Engine "Engine\Binaries\ThirdParty\Python3\Win64\python.exe"
$launch = @("`"$project`"", "-nosplash")
if (-not $WithSound) { $launch += "-nosound" }
Start-Process (Join-Path $Engine "Engine\Binaries\Win64\UnrealEditor.exe") -ArgumentList $launch
$t = Get-Date
do {
    Start-Sleep 3
    & $py (Join-Path $here "ue_remote.py") -c "print('ready')" 2>&1 | Out-Null
} while ($LASTEXITCODE -ne 0 -and ((Get-Date) - $t).TotalSeconds -lt 300)
if ($LASTEXITCODE -ne 0) { "editor did not answer in 300 s"; exit 1 }
"editor ready ({0:N0} s){1}" -f ((Get-Date) - $t).TotalSeconds, $(if ($WithSound) { "" } else { ", no sound" })
