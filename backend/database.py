"""TimescaleDB connection and schema initialization"""
import os
import asyncpg
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://agnipariksha:agnipariksha@localhost:5432/agnipariksha")

pool = None

async def init_db():
    global pool
    pool = await asyncpg.create_pool(DATABASE_URL)
    async with pool.acquire() as conn:
        await conn.execute(CREATE_SCHEMA_SQL)
    print("[DB] TimescaleDB initialized")

CREATE_SCHEMA_SQL = """
-- Test sessions
CREATE TABLE IF NOT EXISTS test_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_type   VARCHAR(20) NOT NULL,  -- tc, hf, letid, bdt, rco, gct
    standard    VARCHAR(50),
    started_at  TIMESTAMPTZ DEFAULT NOW(),
    ended_at    TIMESTAMPTZ,
    status      VARCHAR(10) DEFAULT 'running',  -- running, passed, failed, stopped
    module_id   VARCHAR(100),
    params      JSONB,
    result      JSONB
);

-- Time-series measurements (TimescaleDB hypertable)
CREATE TABLE IF NOT EXISTS test_readings (
    time        TIMESTAMPTZ NOT NULL,
    session_id  UUID REFERENCES test_sessions(id),
    voltage     DOUBLE PRECISION,
    current     DOUBLE PRECISION,
    power       DOUBLE PRECISION,
    temperature DOUBLE PRECISION,
    step_no     INTEGER,
    tags        JSONB
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('test_readings', 'time', if_not_exists => TRUE);

-- Module metadata
CREATE TABLE IF NOT EXISTS modules (
    id          VARCHAR(100) PRIMARY KEY,
    model       VARCHAR(200),
    manufacturer VARCHAR(200),
    pmax_w      DOUBLE PRECISION,
    voc_v       DOUBLE PRECISION,
    isc_a       DOUBLE PRECISION,
    vmpp_v      DOUBLE PRECISION,
    impp_a      DOUBLE PRECISION,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Reports
CREATE TABLE IF NOT EXISTS reports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID REFERENCES test_sessions(id),
    format      VARCHAR(10),  -- pdf, docx
    filepath    TEXT,
    generated_at TIMESTAMPTZ DEFAULT NOW()
);
"""

async def insert_reading(session_id: str, voltage: float, current: float, power: float, step_no: int = 0):
    global pool
    if pool:
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO test_readings (time, session_id, voltage, current, power, step_no) VALUES (NOW(), $1, $2, $3, $4, $5)",
                session_id, voltage, current, power, step_no
            )
