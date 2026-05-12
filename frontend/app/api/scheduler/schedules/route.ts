import { NextResponse } from 'next/server';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const qs = url.search;
  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/scheduler/schedules${qs}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const body = await upstream.json().catch(() => []);
    return NextResponse.json(body, { status: upstream.status });
  } catch (e) {
    return NextResponse.json(
      { error: 'backend_unreachable', message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const payload = await request.json().catch(() => ({}));
  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/scheduler/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
  } catch (e) {
    return NextResponse.json(
      { error: 'backend_unreachable', message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
