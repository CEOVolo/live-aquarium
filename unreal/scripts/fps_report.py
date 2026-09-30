"""Сводка по CSV-профайлу движка (measure_fps.ps1): FPS и время GPU, без первых кадров прогрева.

  python unreal/scripts/fps_report.py <Profile(...).csv> [skip_frames]
"""
import csv
import sys

csv.field_size_limit(1 << 30)   # в последней строке CSV — большие метаданные


def report(path, skip):
    with open(path, encoding="utf-8", errors="ignore") as f:
        rows = list(csv.reader(f))
    # колонки добавляются по ходу записи: полный заголовок — последняя строка с FrameTime
    # (в конце файла, перед метаданными); строки кадров короче его, если колонки появились позже
    head_at = max(j for j, r in enumerate(rows) if "FrameTime" in r)
    head = rows[head_at]
    i = head.index("FrameTime")

    def numeric(r):
        try:
            float(r[i])
            return True
        except (ValueError, IndexError):
            return False

    data = [r + [""] * (len(head) - len(r)) for r in rows[1:head_at] if numeric(r)]
    skip = min(skip, len(data) // 3)
    d = data[skip:]
    ft = sorted(float(r[i]) for r in d)
    n = len(ft)
    print("frames: {} captured, {} measured (first {} skipped)".format(len(data), n, skip))
    print("FPS avg {:.1f} | median {:.1f} | 1% low {:.1f}".format(
        1000 * n / sum(ft), 1000 / ft[n // 2], 1000 / ft[int(n * 0.99)]))
    for col in ("GPUTime", "GPU/Total", "RenderThreadTime", "GameThreadTime"):
        if col in head:
            k = head.index(col)
            v = sorted(float(r[k]) for r in d if r[k])
            if v:
                print("{} ms: median {:.2f}, 99% {:.2f}".format(col, v[len(v) // 2], v[int(len(v) * 0.99)]))
    meta = rows[-1]
    keys = ("systemresolution.resx", "systemresolution.resy", "rhi", "gpu", "streamingpoolsizemb")
    pairs = [(meta[j].lower(), meta[j + 1]) for j in range(len(meta) - 1) if meta[j].lower() in keys]
    if pairs:
        print("meta: " + ", ".join("{}={}".format(k, v) for k, v in pairs))


if __name__ == "__main__":
    report(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 600)
