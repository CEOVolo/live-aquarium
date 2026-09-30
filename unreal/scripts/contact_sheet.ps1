# Контактный лист из кадров lt_*.png (по маске) — для быстрого осмотра.
#   powershell -File unreal/scripts/contact_sheet.ps1 -Pattern "lt_Tmp_*" -Out sheet.png [-Cols 4 -W 640]
param([string]$Pattern = "lt_*.png", [string]$Out = "", [int]$Cols = 4, [int]$W = 640)
Add-Type -AssemblyName System.Drawing
$dir = Join-Path $PSScriptRoot "..\LiveAquarium\Saved\Screenshots\WindowsEditor" | Resolve-Path
if (-not $Out) { $Out = Join-Path $dir "..\contact_sheet.png" }
$files = Get-ChildItem $dir -Filter $Pattern | Sort-Object Name
$H = [int]($W * 9 / 16)
$rows = [math]::Ceiling($files.Count / $Cols)
$sheet = New-Object System.Drawing.Bitmap ($Cols * $W), ($rows * ($H + 22))
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.Clear([System.Drawing.Color]::Black)
$g.InterpolationMode = "HighQualityBicubic"
$font = New-Object System.Drawing.Font "Segoe UI", 11
for ($i = 0; $i -lt $files.Count; $i++) {
    $img = [System.Drawing.Image]::FromFile($files[$i].FullName)
    $x = ($i % $Cols) * $W; $y = [math]::Floor($i / $Cols) * ($H + 22)
    $g.DrawImage($img, $x, $y + 22, $W, $H)
    $g.DrawString(($files[$i].BaseName -replace '^lt_', ''), $font, [System.Drawing.Brushes]::White, $x + 4, $y + 2)
    $img.Dispose()
}
$sheet.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $sheet.Dispose()
(Resolve-Path $Out).Path
