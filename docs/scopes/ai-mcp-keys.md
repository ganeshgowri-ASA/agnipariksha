# feat/ai-mcp-keys — scope

Branch base: c2993a1 (post-PR #29). Will need rebase on PR #32 + PR #23
(threaded AI) once those land.

## Spec (verbatim)

`/settings/ai` page with masked per-provider cards:
- Anthropic Claude (ANTHROPIC_API_KEY)
- OpenAI (OPENAI_API_KEY)
- Perplexity (PERPLEXITY_API_KEY)
- Google Gemini (GEMINI_API_KEY)
- MiMo / OpenRouter (OPENROUTER_API_KEY, MIMO_API_KEY)
- Browserless (BROWSERLESS_API_KEY)
- Qdrant (QDRANT_URL + QDRANT_API_KEY)
- Notion (NOTION_TOKEN + NOTION_DATABASE_ID)

Each card: show-on-hover masked input, Test button (minimal round-trip,
e.g. list-models or ping), Enable/Disable toggle, Set-as-default for AI
Assistant, fallback chain on failure.

## MCP server (backend/mcp/server.py)
Stdio MCP server exposing tools:
- list_supplies
- start_test(test_name, supply_ids)
- get_telemetry(supply_id)
- generate_report(test_id, format)
- query_db(sql)
- predict_maintenance()

Tools call back into the FastAPI app (TestClient or http localhost) so a
single source of truth.

## Endpoints
- POST /api/ai/keys — Test + Save per provider (Fernet-encrypted at rest).
- GET  /api/ai/keys — returns {provider, set:true|false, last_tested, status} only; never raw keys.
- POST /api/ai/keys/test/:provider — round-trip ping.
- POST /api/ai/keys/default — set default for AI Assistant.

## Secrets
- Fernet + OS keyring (same key-management scheme as feat/db-connectors).
- Never log raw keys; mask in audit log.

## Tests
- pytest: per-provider mock round-trip (use respx/httpx-mock).
- Round-trip: save key -> Test -> response 200 -> hot-swap default -> AI Assistant picks the new provider on the next call.

## Verification
- /api/ai/keys returns the 8-provider matrix with set=true/false flags.
- AI Assistant panel hits the active provider; switching providers in the UI takes effect on the next prompt with no restart.
- MCP server lists 6 tools when attached to Claude Desktop / Cursor / Windsurf.

## Open follow-ups for an attached session
1. PR #23 (threaded-ai-assistant) is the integration point for the assistant panel.
2. /api/ai/ask is already on main (from PR #31) — extend with provider-switching.
3. The MCP server should reuse the existing FastAPI app; do not duplicate routes.
