# Скачивание CC0-ассетов Poly Haven для пробы картинки (2K).
#   powershell -File scripts/assets/fetch_polyhaven.ps1
# Текстуры -> assets/textures/raw/<id>/, модели (glTF) -> assets/models/raw/polyhaven/<id>/
param([string]$Res = "2k")
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")

$textures = @("coast_sand_01", "dense_sand", "coral_gravel")
$maps = @("Diffuse", "nor_gl", "arm", "Displacement")
$models = @("coast_rocks_05", "coast_rocks_02", "rock_09", "boulder_01")

function Get-File($url, $dest) {
    if (Test-Path $dest) { return }
    New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
    Invoke-WebRequest $url -OutFile $dest -UseBasicParsing
    "  {0} ({1:N1} MB)" -f (Split-Path $dest -Leaf), ((Get-Item $dest).Length / 1MB)
}

foreach ($id in $textures) {
    "texture $id"
    $f = Invoke-RestMethod "https://api.polyhaven.com/files/$id"
    foreach ($m in $maps) {
        $x = $f.$m.$Res.jpg
        if (-not $x) { $x = $f.$m.$Res.png }
        if ($x) { Get-File $x.url (Join-Path $root "assets\textures\raw\$id\$(Split-Path $x.url -Leaf)") }
    }
}

foreach ($id in $models) {
    "model $id"
    $f = Invoke-RestMethod "https://api.polyhaven.com/files/$id"
    $g = $f.gltf.$Res.gltf
    $dir = Join-Path $root "assets\models\raw\polyhaven\$id"
    Get-File $g.url (Join-Path $dir (Split-Path $g.url -Leaf))
    foreach ($p in $g.include.PSObject.Properties) {
        Get-File $p.Value.url (Join-Path $dir ($p.Name -replace '/', '\'))
    }
}
"done"
