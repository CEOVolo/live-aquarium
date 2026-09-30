"""Рендер LS_LookTest через Movie Render Queue в JPG-кадры (1920x1080), затем encode_movie.ps1 -> MP4.

Запуск: python ue_remote.py render_movie.py; готовность — файл Saved/MovieRenders/lt_movie_done.txt
Только диапазон кадров: Saved/lt_movie_range.txt «начало,конец» (для проб).
"""
import builtins
import os
import sys

import unreal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402
import lt_common  # noqa: E402
importlib.reload(lt_common)  # редактор держит модули между запусками
from lt_common import MAP, log

SEQ = "/Game/LookTest/Cinematics/LS_LookTest"
SAVED = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir())
OUT = os.path.join(SAVED, "MovieRenders", "looktest")
DONE = os.path.join(SAVED, "MovieRenders", "lt_movie_done.txt")
RANGE = os.path.join(SAVED, "lt_movie_range.txt")

os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    os.remove(os.path.join(OUT, f))
if os.path.exists(DONE):
    os.remove(DONE)

mrq = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
queue = mrq.get_queue()
queue.delete_all_jobs()
job = queue.allocate_new_job(unreal.MoviePipelineExecutorJob)
job.set_editor_property("job_name", "looktest")
job.set_editor_property("sequence", unreal.SoftObjectPath(SEQ + "." + SEQ.rsplit("/", 1)[1]))
job.set_editor_property("map", unreal.SoftObjectPath(MAP + "." + MAP.rsplit("/", 1)[1]))
cfg = job.get_configuration()

out = cfg.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
out.set_editor_property("output_directory", unreal.DirectoryPath(OUT.replace("\\", "/")))
out.set_editor_property("output_resolution", unreal.IntPoint(1920, 1080))
out.set_editor_property("file_name_format", "{sequence_name}.{frame_number}")
out.set_editor_property("zero_pad_frame_numbers", 5)
if os.path.exists(RANGE):
    with open(RANGE, encoding="utf-8-sig") as f:
        a, b = [int(x) for x in f.read().split(",")]
    out.set_editor_property("use_custom_playback_range", True)
    out.set_editor_property("custom_start_frame", a)
    out.set_editor_property("custom_end_frame", b)
    log("movie range {}..{}".format(a, b))

cfg.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPassBase)
cfg.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_JPG)
aa = cfg.find_or_add_setting_by_class(unreal.MoviePipelineAntiAliasingSetting)
# TSR даёт сглаживание; прогрев — чтобы Lumen, объёмный туман и TSR сошлись до первого кадра
aa.set_editor_property("spatial_sample_count", 1)
aa.set_editor_property("temporal_sample_count", 1)
aa.set_editor_property("engine_warm_up_count", 60)
aa.set_editor_property("render_warm_up_count", 32)
aa.set_editor_property("use_camera_cut_for_warm_up", True)


def finished(executor, success):
    with open(DONE, "w", encoding="utf-8") as f:
        f.write("success\n" if success else "failed\n")
    unreal.log("LOOKTEST movie render finished: {}".format(success))


executor = mrq.render_queue_with_executor(unreal.MoviePipelinePIEExecutor)
executor.on_executor_finished_delegate.add_callable(finished)
builtins._lt_movie_executor = executor   # держать ссылку, пока идёт рендер
log("movie render started -> " + OUT)
