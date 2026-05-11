# Agnipariksha MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server that
exposes the Agnipariksha PV-module reliability test station to MCP-aware
clients (Claude Desktop, Claude Code IDE, custom hosts).

It proxies tool calls to the FastAPI backend (`backend/main.py`) which in
turn drives the ITECH PV6000 over raw TCP SCPI.

## Tools

| Tool | Description |
|------|-------------|
| `get_session_data` | Fetch the full log (V/I/P/T + events) for a session. |
| `get_live_measurement` | Latest live sample from the active test. |
| `start_test` | Start an IEC test: `TC`, `HF`, `LeTID`, `BDT`, `RCO`, or `GCT`. |
| `stop_test` | Stop the active test and turn the DC source OFF. |
| `analyze_letid` | IEC TS 63342 LeTID indicators (`Idark = Isc − Imp` @ 75 °C). |
| `detect_anomalies` | Flag V/I/T excursions and thermal-runaway markers. |
| `generate_report` | Render a compliance report (PDF / Markdown / JSON). |

## Install & build

```bash
cd mcp
npm install
npm run build
```

The compiled entry point is `dist/index.js` (stdio transport).

## Configuration

Environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGNIPARIKSHA_BACKEND_URL` | `http://localhost:8000` | FastAPI base URL. |

The backend is expected to expose:

```
GET  /api/sessions/{id}
GET  /api/live
POST /api/tests/start          { test, session_name?, params? }
POST /api/tests/stop           { session_id? }
POST /api/analysis/letid       { session_id, temperature_c }
POST /api/analysis/anomalies   { session_id, voltage_band?, current_band?, temperature_max_c? }
POST /api/reports/generate     { session_id, standard?, format }
```

(The current `backend/main.py` ships `/health`, `/api/scpi`, and
`/ws/live`; the routes above are the contract this MCP server speaks
once backend coverage is extended.)

## Register with Claude Desktop

Edit your Claude Desktop config:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "agnipariksha": {
      "command": "node",
      "args": ["/absolute/path/to/agnipariksha/mcp/dist/index.js"],
      "env": {
        "AGNIPARIKSHA_BACKEND_URL": "http://localhost:8000"
      }
    }
  }
}
```

Restart Claude Desktop. The Agnipariksha tools will appear in the
tool picker.

## Register with Claude Code IDE

From the project root:

```bash
claude mcp add agnipariksha \
  --command node \
  --args "$(pwd)/mcp/dist/index.js" \
  --env AGNIPARIKSHA_BACKEND_URL=http://localhost:8000
```

Or add manually to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "agnipariksha": {
      "command": "node",
      "args": ["./mcp/dist/index.js"],
      "env": { "AGNIPARIKSHA_BACKEND_URL": "http://localhost:8000" }
    }
  }
}
```

Then `/mcp` inside Claude Code to verify the server is connected.

## Manual smoke test

You can drive the server over stdio with any MCP client. The smallest
sanity check is the `tools/list` request:

```bash
node dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
EOF
```

## Manifest

`mcp.json` describes the server for registries / discoverability. It is
not consumed by Claude Desktop directly but is useful for catalog tools.
