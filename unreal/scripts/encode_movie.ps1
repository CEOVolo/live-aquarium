# Собрать MP4 (H.264) из кадров render_movie.py. ffmpeg — из pip-пакета imageio-ffmpeg системного Python.
#   powershell -File unreal/scripts/encode_movie.ps1 [-Out путь.mp4] [-Fps 30]
param([string]$Out = "", [int]$Fps = 30)
$ErrorActionPreference = "Stop"
$frames = Join-Path $PSScriptRoot "..\LiveAquarium\Saved\MovieRenders\looktest" | Resolve-Path
if (-not $Out) { $Out = Join-Path $frames "..\LiveAquarium_looktest.mp4" }
$ffmpeg = python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
$first = Get-ChildItem $frames -Filter "*.jpeg" | Sort-Object Name | Select-Object -First 1
if (-not $first) { "no frames in $frames"; exit 1 }
$start = [int]($first.BaseName -replace '.*\.(\d+)$', '$1')
$pattern = Join-Path $frames (($first.BaseName -replace '\.\d+$', '') + ".%05d.jpeg")
& $ffmpeg -y -loglevel error -framerate $Fps -start_number $start -i $pattern `
    -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart $Out
"{0} ({1:N1} MB, {2} frames)" -f (Resolve-Path $Out).Path, ((Get-Item $Out).Length / 1MB), (Get-ChildItem $frames -Filter *.jpeg).Count
