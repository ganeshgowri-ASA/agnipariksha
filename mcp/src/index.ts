#!/usr/bin/env node
/**
 * Agnipariksha MCP server.
 *
 * Exposes PV-test-station tools over the Model Context Protocol (stdio
 * transport) by proxying requests to the FastAPI backend at
 * AGNIPARIKSHA_BACKEND_URL (default http://localhost:8000).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const BACKEND_URL =
  process.env.AGNIPARIKSHA_BACKEND_URL?.replace(/\/$/, "") ??
  "http://localhost:8000";

const IEC_TESTS = ["TC", "HF", "LeTID", "BDT", "RCO", "GCT"] as const;

const StartTestSchema = z.object({
  test: z.enum(IEC_TESTS),
  session_name: z.string().optional(),
  params: z.record(z.unknown()).optional(),
});

const SessionIdSchema = z.object({
  session_id: z.string().min(1),
});

const AnalyzeLetidSchema = z.object({
  session_id: z.string().min(1),
  temperature_c: z.number().default(75),
});

const DetectAnomaliesSchema = z.object({
  session_id: z.string().min(1),
  voltage_band: z
    .object({ min: z.number(), max: z.number() })
    .optional(),
  current_band: z
    .object({ min: z.number(), max: z.number() })
    .optional(),
  temperature_max_c: z.number().optional(),
});

const GenerateReportSchema = z.object({
  session_id: z.string().min(1),
  standard: z
    .enum([
      "IEC 61215 MQT11",
      "IEC 61215 MQT12",
      "IEC TS 63342",
      "IEC 62979",
      "IEC 61730 MST26",
      "IEC 61730 MST13",
    ])
    .optional(),
  format: z.enum(["pdf", "markdown", "json"]).default("pdf"),
});

const TOOLS: Tool[] = [
  {
    name: "get_session_data",
    description:
      "Fetch the full data log (timestamps, V, I, P, T, events) for a completed or in-progress test session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Backend session ID." },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_live_measurement",
    description:
      "Get the most recent live V/I/P/T sample from the active test (or demo stream if hardware is offline).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "start_test",
    description:
      "Start an IEC test on the ITECH PV6000. Test must be one of TC, HF, LeTID, BDT, RCO, GCT.",
    inputSchema: {
      type: "object",
      properties: {
        test: {
          type: "string",
          enum: [...IEC_TESTS],
          description:
            "IEC test ID: TC (61215 MQT11), HF (MQT12), LeTID (TS 63342), BDT (62979), RCO (61730 MST26), GCT (MST13).",
        },
        session_name: {
          type: "string",
          description: "Optional human-readable name for the session.",
        },
        params: {
          type: "object",
          description:
            "Test-specific parameters (cycle count, setpoint voltage, current limit, duration, etc.).",
          additionalProperties: true,
        },
      },
      required: ["test"],
    },
  },
  {
    name: "stop_test",
    description:
      "Stop the currently running test, turn the DC source output OFF, and finalize the session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session to stop. If omitted, stops the active session.",
        },
      },
    },
  },
  {
    name: "analyze_letid",
    description:
      "Compute IEC TS 63342 LeTID indicators (Idark = Isc - Imp) at the given module temperature for the session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        temperature_c: {
          type: "number",
          description: "Module temperature in °C (LeTID standard: 75).",
          default: 75,
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "detect_anomalies",
    description:
      "Scan a session for V/I/T excursions outside expected bands and flag thermal-runaway or arcing signatures.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        voltage_band: {
          type: "object",
          properties: {
            min: { type: "number" },
            max: { type: "number" },
          },
          required: ["min", "max"],
        },
        current_band: {
          type: "object",
          properties: {
            min: { type: "number" },
            max: { type: "number" },
          },
          required: ["min", "max"],
        },
        temperature_max_c: { type: "number" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "generate_report",
    description:
      "Render a compliance report for the session against the chosen IEC standard.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        standard: {
          type: "string",
          enum: [
            "IEC 61215 MQT11",
            "IEC 61215 MQT12",
            "IEC TS 63342",
            "IEC 62979",
            "IEC 61730 MST26",
            "IEC 61730 MST13",
          ],
        },
        format: {
          type: "string",
          enum: ["pdf", "markdown", "json"],
          default: "pdf",
        },
      },
      required: ["session_id"],
    },
  },
];

type JsonRecord = Record<string, unknown>;

async function backendRequest(
  path: string,
  init: RequestInit = {},
): Promise<JsonRecord> {
  const url = `${BACKEND_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `Backend ${init.method ?? "GET"} ${path} failed: ${res.status} ${res.statusText} — ${text.slice(0, 400)}`,
    );
  }
  return body as JsonRecord;
}

function ok(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

const server = new Server(
  { name: "agnipariksha-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: rawArgs } = req.params;
  const args = rawArgs ?? {};

  try {
    switch (name) {
      case "get_session_data": {
        const { session_id } = SessionIdSchema.parse(args);
        return ok(
          await backendRequest(
            `/api/sessions/${encodeURIComponent(session_id)}`,
          ),
        );
      }
      case "get_live_measurement": {
        return ok(await backendRequest("/api/live"));
      }
      case "start_test": {
        const parsed = StartTestSchema.parse(args);
        return ok(
          await backendRequest("/api/tests/start", {
            method: "POST",
            body: JSON.stringify(parsed),
          }),
        );
      }
      case "stop_test": {
        const session_id =
          typeof (args as JsonRecord).session_id === "string"
            ? ((args as JsonRecord).session_id as string)
            : undefined;
        return ok(
          await backendRequest("/api/tests/stop", {
            method: "POST",
            body: JSON.stringify(session_id ? { session_id } : {}),
          }),
        );
      }
      case "analyze_letid": {
        const parsed = AnalyzeLetidSchema.parse(args);
        return ok(
          await backendRequest("/api/analysis/letid", {
            method: "POST",
            body: JSON.stringify(parsed),
          }),
        );
      }
      case "detect_anomalies": {
        const parsed = DetectAnomaliesSchema.parse(args);
        return ok(
          await backendRequest("/api/analysis/anomalies", {
            method: "POST",
            body: JSON.stringify(parsed),
          }),
        );
      }
      case "generate_report": {
        const parsed = GenerateReportSchema.parse(args);
        return ok(
          await backendRequest("/api/reports/generate", {
            method: "POST",
            body: JSON.stringify(parsed),
          }),
        );
      }
      default:
        return fail(new Error(`Unknown tool: ${name}`));
    }
  } catch (err) {
    return fail(err);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[agnipariksha-mcp] connected (backend=${BACKEND_URL}, tools=${TOOLS.length})`,
  );
}

main().catch((err) => {
  console.error("[agnipariksha-mcp] fatal:", err);
  process.exit(1);
});
