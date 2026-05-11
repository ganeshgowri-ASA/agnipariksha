"""Agnipariksha Backend — FastAPI Server"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
import json
import os
from dotenv import load_dotenv

from scpi_driver import SCPIDriver
from database import init_db
from models import TestSession, TestReading, TestResult

load_dotenv()

scpi = SCPIDriver(
    host=os.getenv("ITECH_IP", "192.168.200.100"),
    port=int(os.getenv("ITECH_PORT", 30000)),
    demo_mode=os.getenv("DEMO_MODE", "false").lower() == "true"
)

active_connections: list[WebSocket] = []

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await scpi.disconnect()

app = FastAPI(
    title="Agnipariksha API",
    description="PV Reliability Test Station by Shreshtata Power Supplies",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- WebSocket for live data ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            if scpi.is_connected:
                data = await scpi.measure_all()
                await websocket.send_json(data)
            await asyncio.sleep(0.5)  # 2 Hz update
    except WebSocketDisconnect:
        active_connections.remove(websocket)

# --- REST API Endpoints ---
@app.get("/health")
async def health():
    return {"status": "ok", "hardware": scpi.is_connected, "demo": scpi.demo_mode}

@app.post("/connect")
async def connect():
    result = await scpi.connect()
    return {"connected": result, "idn": await scpi.idn()}

@app.post("/disconnect")
async def disconnect():
    await scpi.disconnect()
    return {"connected": False}

@app.get("/measure")
async def measure():
    return await scpi.measure_all()

@app.post("/output/{state}")
async def set_output(state: str):
    await scpi.set_output(state.upper() == "ON")
    return {"output": state.upper()}

@app.post("/tests/tc/start")
async def start_thermal_cycling():
    from test_programs.thermal_cycling import ThermalCyclingTest
    test = ThermalCyclingTest(scpi)
    session_id = await test.start()
    return {"session_id": session_id, "test": "thermal_cycling", "status": "running"}

@app.post("/tests/letid/start")
async def start_letid():
    from test_programs.letid import LeTIDTest
    test = LeTIDTest(scpi)
    session_id = await test.start()
    return {"session_id": session_id, "test": "letid", "status": "running"}

@app.post("/tests/gct/start")
async def start_ground_continuity():
    from test_programs.ground_continuity import GroundContinuityTest
    test = GroundContinuityTest(scpi)
    result = await test.run()
    return result

@app.post("/tests/{session_id}/stop")
async def stop_test(session_id: str):
    await scpi.emergency_stop()
    return {"session_id": session_id, "status": "stopped"}

@app.get("/tests/{session_id}/data")
async def get_test_data(session_id: str, limit: int = 1000):
    # Query TimescaleDB
    return {"session_id": session_id, "readings": []}

@app.post("/reports/{session_id}/generate")
async def generate_report(session_id: str, format: str = "pdf"):
    from report_generator import generate
    path = await generate(session_id, format)
    return {"path": path, "format": format}
