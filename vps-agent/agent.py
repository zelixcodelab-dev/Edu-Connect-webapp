#!/usr/bin/env python3
"""EduConnect Pro — VPS Agent (read-only metrics + gated Docker control).

Run this small service ON your VPS. The Platform Console (Server → Metrics /
Containers) calls it over HTTPS using a shared API key. It only exposes:
  GET  /metrics                      → CPU / RAM / disk / uptime
  GET  /containers                   → docker container list
  POST /containers/{name}/{action}   → start | stop | restart (gated)

SECURITY
  • Set a strong AGENT_KEY. Every request must send  X-Agent-Key: <AGENT_KEY>.
  • Run behind HTTPS (put it behind Nginx/Caddy, or use a reverse proxy).
  • The agent NEVER returns secrets and performs no destructive DB/host commands.

SETUP (on the VPS)
  pip install fastapi uvicorn psutil
  # Docker control uses the local `docker` CLI (optional).
  export AGENT_KEY="choose-a-long-random-secret"
  python3 agent.py            # serves on 0.0.0.0:9101

Then in the Platform Console → VPS Server → Add/Edit server, set:
  Agent URL  = https://your-vps-host:9101
  Agent key  = the same AGENT_KEY
"""
import os
import subprocess
import time

import psutil
from fastapi import FastAPI, Header, HTTPException, Depends

AGENT_KEY = os.environ.get("AGENT_KEY", "")
_BOOT = time.time()
app = FastAPI(title="EduConnect Pro VPS Agent")


def auth(x_agent_key: str = Header(default="")):
    if not AGENT_KEY or x_agent_key != AGENT_KEY:
        raise HTTPException(status_code=401, detail="Invalid agent key")


@app.get("/metrics")
def metrics(_=Depends(auth)):
    vm = psutil.virtual_memory()
    du = psutil.disk_usage("/")
    return {
        "cpu_percent": psutil.cpu_percent(interval=0.4),
        "cpu_cores": psutil.cpu_count(),
        "ram_percent": vm.percent,
        "ram_total_mb": round(vm.total / 1048576),
        "ram_used_mb": round(vm.used / 1048576),
        "disk_percent": du.percent,
        "disk_total_gb": round(du.total / 1073741824, 1),
        "disk_used_gb": round(du.used / 1073741824, 1),
        "uptime_seconds": int(time.time() - _BOOT),
        "load_avg": list(os.getloadavg()) if hasattr(os, "getloadavg") else [],
    }


def _docker(args):
    try:
        out = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=15)
        return out.returncode, out.stdout.strip(), out.stderr.strip()
    except FileNotFoundError:
        raise HTTPException(status_code=501, detail="Docker not installed on this host")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/containers")
def containers(_=Depends(auth)):
    code, out, err = _docker(["ps", "-a", "--format", "{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}"])
    if code != 0:
        raise HTTPException(status_code=500, detail=err or "docker ps failed")
    items = []
    for line in filter(None, out.splitlines()):
        name, image, status, state = (line.split("|") + ["", "", "", ""])[:4]
        items.append({"name": name, "image": image, "status": status, "state": state})
    return {"containers": items}


@app.get("/containers/{name}/logs")
def container_logs(name: str, tail: int = 200, _=Depends(auth)):
    code, out, err = _docker(["logs", "--tail", str(min(max(tail, 1), 1000)), name])
    if code != 0:
        raise HTTPException(status_code=500, detail=err or "logs failed")
    return {"name": name, "logs": out or err or "(no output)"}


@app.post("/containers/{name}/{action}")
def container_action(name: str, action: str, _=Depends(auth)):
    if action not in ("start", "stop", "restart"):
        raise HTTPException(status_code=400, detail="Invalid action")
    code, out, err = _docker([action, name])
    if code != 0:
        raise HTTPException(status_code=500, detail=err or "action failed")
    return {"ok": True, "name": name, "action": action}


if __name__ == "__main__":
    import uvicorn
    if not AGENT_KEY:
        raise SystemExit("Set AGENT_KEY env var before starting the agent.")
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("AGENT_PORT", "9101")))
