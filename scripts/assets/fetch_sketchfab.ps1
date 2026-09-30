# Скачивание сканов рифа с Sketchfab по файлу временных ссылок.
# Ссылки выдаёт только залогиненная сессия Sketchfab: их собирает браузер пользователя
# (скрипт на странице sketchfab.com) в lt_sketchfab_links.json в «Загрузках».
#   powershell -File scripts/assets/fetch_sketchfab.ps1 [-Links путь]
# Ссылки живут несколько минут — запускать сразу. Сами ссылки не печатаются.
param([string]$Links = (Join-Path $env:USERPROFILE "Downloads\lt_sketchfab_links.json"))
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # полоса прогресса замедляет Invoke-WebRequest в разы
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$dest = Join-Path $root "assets\models\raw\sketchfab"
New-Item -ItemType Directory -Force $dest | Out-Null

$data = Get-Content $Links -Raw -Encoding utf8 | ConvertFrom-Json
foreach ($p in $data.PSObject.Properties) {
    $out = Join-Path $dest ($p.Name + ".glb")
    if ((Test-Path $out) -and (Get-Item $out).Length -eq $p.Value.size) { "{0}: already here" -f $p.Name; continue }
    $t = Get-Date
    Invoke-WebRequest $p.Value.url -OutFile $out -UseBasicParsing
    $len = (Get-Item $out).Length
    $magic = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($out)[0..3])
    "{0}: {1:N1} MB, tex {2}, {3:N0}s, {4}" -f $p.Name, ($len / 1MB), $p.Value.tex, ((Get-Date) - $t).TotalSeconds,
        $(if ($magic -eq "glTF") { "ok" } else { "NOT A GLB" })
}
