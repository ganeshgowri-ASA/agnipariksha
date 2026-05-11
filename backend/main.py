"""FastAPI backend for Agnipariksha PV test station.
Runs WebSocket server that bridges SCPI commands to ITECH PV6000.
"""
import asyncio
import json
import time
import random
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Agnipariksha Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:1420"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- In-memory state ---
connected_clients: list[WebSocket] = []
demo_mode = True  # Set False when real hardware connected


@app.get("/health")
async def health():
    return {"status": "ok", "demo": demo_mode, "version": "1.0.0"}


@app.websocket("/ws/live")
async def websocket_live(ws: WebSocket):
    await ws.accept()
    connected_clients.append(ws)
    t = 0
    try:
        while True:
            # In demo mode: generate synthetic readings
            if demo_mode:
                t += 1
                v = 48.0 + 5 * (t % 30) / 30 + random.gauss(0, 0.2)
                i = 10.0 + 2 * (t % 20) / 20 + random.gauss(0, 0.05)
                reading = {
                    "timestamp": int(time.time() * 1000),
                    "voltage": round(v, 3),
                    "current": round(i, 3),
                    "power": round(v * i / 1000, 4),
                    "temperature": round(75 + random.gauss(0, 0.5), 1),
                }
                await ws.send_text(json.dumps(reading))
                await asyncio.sleep(0.5)

            # Listen for SCPI commands from frontend
            try:
                data = await asyncio.wait_for(ws.receive_text(), timeout=0.1)
                msg = json.loads(data)
                if msg.get("type") == "scpi":
                    cmd = msg["command"]
                    print(f"[SCPI] {cmd}")
                    # TODO: Forward to real SCPI driver when demo_mode=False
            except asyncio.TimeoutError:
                pass

    except WebSocketDisconnect:
        connected_clients.remove(ws)


class SCPICommand(BaseModel):
    command: str


@app.post("/api/scpi")
async def send_scpi(cmd: SCPICommand):
    # Forward to real driver in production
    print(f"[HTTP SCPI] {cmd.command}")
    return {"sent": cmd.command, "demo": demo_mode}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
