# Снять кадры в открытом редакторе и дождаться окончания.
#   powershell -File unreal/scripts/shots.ps1 [-Cams Cam_Wide,Cam_Shark]
param([string[]]$Cams = @(), [int]$TimeoutSec = 1800)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$saved = Join-Path $here "..\LiveAquarium\Saved" | Resolve-Path
$engine = if ($env:UE_ROOT) { $env:UE_ROOT } else { "D:\UE\UE_5.8" }
$py = Join-Path $engine "Engine\Binaries\ThirdParty\Python3\Win64\python.exe"
$done = Join-Path $saved "Screenshots\lt_done.txt"
$camsFile = Join-Path $saved "lt_cams.txt"

if ($Cams.Count) { Set-Content $camsFile ($Cams -join ",") -Encoding utf8 } elseif (Test-Path $camsFile) { Remove-Item $camsFile }
if (Test-Path $done) { Remove-Item $done }
& $py (Join-Path $here "ue_remote.py") render_shots.py
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$t = Get-Date
while (-not (Test-Path $done)) {
    if (((Get-Date) - $t).TotalSeconds -gt $TimeoutSec) { "timeout waiting for shots"; exit 1 }
    Start-Sleep -Seconds 2
}
Get-Content $done
Get-ChildItem (Join-Path $saved "Screenshots\WindowsEditor") -Filter "lt_*.png" | Select-Object Name, LastWriteTime
