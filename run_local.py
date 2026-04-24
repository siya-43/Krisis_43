from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path


import socket

ROOT = Path(__file__).resolve().parent


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


SERVICES = [
    {
        "name": "backend",
        "command": [sys.executable, "-m", "app.main"],
        "url": "http://127.0.0.1:8000/health",
        "required": True,
    },
    {
        "name": "vision",
        "command": [sys.executable, "-m", "vision.service"],
        "url": "http://127.0.0.1:8010/health",
        "required": False,
    },
    {
        "name": "gateway",
        "command": [str(ROOT / "tools" / "nginx-1.24.0" / "nginx.exe"), "-p", str(ROOT / "tools" / "nginx-1.24.0"), "-c", str(ROOT / "tools" / "nginx.conf")],
        "url": "http://127.0.0.1:8080/",
        "required": True,
    },
    {
        "name": "webhook",
        "command": [sys.executable, str(ROOT / "tools" / "webhook_server.py")],
        "url": "http://127.0.0.1:8090/",
        "required": False,
    },
]


def start_service(service: dict[str, object]) -> subprocess.Popen[str]:
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP

    process = subprocess.Popen(
        service["command"],
        cwd=ROOT,
        text=True,
        creationflags=creationflags,
    )
    return process


def stop_service(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return

    try:
        if isinstance(process.args, list) and len(process.args) > 0 and "nginx" in str(process.args[0]).lower():
            subprocess.run([str(process.args[0]), "-s", "stop", "-c", str(process.args[2])], check=False)
            time.sleep(1)
        elif os.name == "nt":
            process.send_signal(signal.CTRL_BREAK_EVENT)
            time.sleep(1)
        else:
            process.terminate()
            process.wait(timeout=3)
    except Exception:
        pass

    if process.poll() is None:
        process.terminate()
        time.sleep(1)

    if process.poll() is None:
        process.kill()


def main() -> int:
    print("==========================================================")
    print("    KRISIS - COMMAND CENTER INITIALIZATION")
    print("==========================================================")

    processes: list[tuple[dict[str, object], subprocess.Popen[str]]] = []

    try:
        for service in SERVICES:
            name = service["name"]
            print(f"[start] {name}")
            process = start_service(service)
            processes.append((service, process))
            time.sleep(2)

            if process.poll() is not None and service["required"]:
                print(f"[error] {name} exited immediately with code {process.returncode}")
                return 1

        local_ip = get_local_ip()
        print()
        print("Local stack is starting on localhost:")
        print("  Backend health: http://127.0.0.1:8000/health")
        print("  Vision health:  http://127.0.0.1:8010/health")
        print("  Product UI:     http://127.0.0.1:8080/")
        print()
        print("--- MOBILE REMOTE ACCESS ---")
        print(f"  SOS Portal:     http://{local_ip}:8080/sos.html")
        print(f"  Command Center: http://{local_ip}:8080/")
        print("  (Make sure your phone is on the same WiFi)")
        print("----------------------------")
        print()
        print("Keep this terminal open. Press Ctrl+C to stop all services.")

        while True:
            time.sleep(2)
            for service, process in processes:
                if process.poll() is not None and service["required"]:
                    print(f"[error] Required service '{service['name']}' stopped with code {process.returncode}")
                    return 1
    except KeyboardInterrupt:
        print()
        print("Stopping local stack...")
        return 0
    finally:
        for _, process in reversed(processes):
            stop_service(process)


if __name__ == "__main__":
    raise SystemExit(main())
                                    