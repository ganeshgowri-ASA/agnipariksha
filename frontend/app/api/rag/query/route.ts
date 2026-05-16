import { NextRequest, NextResponse } from 'next/server';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

export async function POST(req: NextRequest): Promise<Response> {
  let body: { q?: string; top_k?: number } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const q = (body.q ?? '').trim();
  if (!q) {
    return NextResponse.json({ error: 'q_required' }, { status: 400 });
  }
  const topK = Number.isFinite(body.top_k) ? Number(body.top_k) : 5;

  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/rag/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, top_k: topK }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const data = await upstream.json().catch(() => ({}));
    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    return NextResponse.json(
      { error: 'backend_unreachable', message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
