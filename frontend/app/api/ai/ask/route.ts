import { NextRequest, NextResponse } from 'next/server';

// Simple in-memory TTL cache for canned "what changed today" prompts.
// Keyed by SHA-1 of the prompt body so identical asks within the TTL
// return instantly without burning tokens.
type Entry = { value: string; expires: number };
const CACHE = new Map<string, Entry>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

async function sha1(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function getCached(key: string): string | null {
  const e = CACHE.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) {
    CACHE.delete(key);
    return null;
  }
  return e.value;
}

function putCached(key: string, value: string): void {
  CACHE.set(key, { value, expires: Date.now() + TTL_MS });
}

const DEFAULT_PROMPT =
  'In 4-6 short bullets, summarise what changed in the PV test station today: ' +
  'tests started, pass/fail trends, equipment alerts, open tickets, low-stock spares. ' +
  'Be concrete and reference IEC clauses if any thresholds were crossed.';

export async function POST(req: NextRequest) {
  let body: { prompt?: string; context?: string } = {};
  try {
    body = await req.json();
  } catch {
    // fall through with defaults
  }
  const prompt = body.prompt?.trim() || DEFAULT_PROMPT;
  const context = body.context ?? '';
  const cacheKey = await sha1(`${prompt}\n---\n${context}`);

  const hit = getCached(cacheKey);
  if (hit) {
    return NextResponse.json({ response: hit, cached: true });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const demo =
      '[Demo Mode — No API Key]\n' +
      '• 4 tests started since 06:00 (TC, HF, DH, GCT)\n' +
      '• Pass rate 92% (rolling 24h); 1 BDT failure pending review\n' +
      '• Chamber #2 temperature drift +0.4 °C — within tolerance\n' +
      '• 2 open tickets (1 P2 on PV6000 fan)\n' +
      '• Spares: bypass diode SBR40 stock at 3 (below reorder point 5)';
    putCached(cacheKey, demo);
    return NextResponse.json({ response: demo, cached: false, demo: true });
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 512,
        system:
          'You are the duty reliability engineer for an Agnipariksha PV test ' +
          'station. Summarise the last 24h crisply. Use bullets, no preamble.',
        messages: [
          { role: 'user', content: `Context:\n${context}\n\nTask:\n${prompt}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const text = data?.content?.[0]?.text ?? '(no response)';
    putCached(cacheKey, text);
    return NextResponse.json({ response: text, cached: false });
  } catch (err) {
    return NextResponse.json(
      { response: `AI error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
