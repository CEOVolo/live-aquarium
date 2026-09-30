"""Выполнить Python-скрипт в уже открытом редакторе Unreal (Python Remote Execution).

В проекте включено bRemoteExecution (Config/DefaultEngine.ini). Запускать Python-ом движка:
  D:/UE/UE_5.8/Engine/Binaries/ThirdParty/Python3/Win64/python.exe unreal/scripts/ue_remote.py render_shots.py
  ... ue_remote.py -c "import unreal; print(unreal.SystemLibrary.get_engine_version())"
"""
import os
import sys
import time

ENGINE = os.environ.get("UE_ROOT", "D:/UE/UE_5.8")
sys.path.insert(0, os.path.join(ENGINE, "Engine/Plugins/Experimental/PythonScriptPlugin/Content/Python"))
import remote_execution as rx  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    if args[0] == "-c":
        command, mode = args[1], rx.MODE_EXEC_STATEMENT
    else:
        path = args[0] if os.path.isfile(args[0]) else os.path.join(HERE, args[0])
        command, mode = os.path.abspath(path).replace("\\", "/"), rx.MODE_EXEC_FILE

    remote = rx.RemoteExecution()
    remote.start()
    try:
        deadline = time.time() + 20
        while not remote.remote_nodes and time.time() < deadline:
            time.sleep(0.2)
        if not remote.remote_nodes:
            sys.exit("no Unreal editor found (is it open with this project?)")
        remote.open_command_connection(remote.remote_nodes[0]["node_id"])
        res = remote.run_command(command, unattended=True, exec_mode=mode)
        for line in res.get("output", []):
            print(line.get("output", "").rstrip())
        if res.get("result") not in (None, "None", ""):
            print(res["result"])
        if not res.get("success"):
            sys.exit(1)
    finally:
        remote.stop()


if __name__ == "__main__":
    main()
