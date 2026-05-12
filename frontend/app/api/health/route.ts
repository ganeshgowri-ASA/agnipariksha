import { NextResponse } from 'next/server';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

export async function GET(): Promise<Response> {
  const ts = new Date().toISOString();

  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { status: 'degraded', frontend: 'ok', backend: { status: upstream.status }, timestamp: ts },
        { status: 200 },
      );
    }
    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(
      { status: 'ok', frontend: 'ok', backend: body, timestamp: ts },
      { status: 200 },
    );
  } catch (e) {
    return NextResponse.json(
      {
        status: 'degraded',
        frontend: 'ok',
        backend: { status: 'unreachable', error: e instanceof Error ? e.message : String(e) },
        timestamp: ts,
      },
      { status: 200 },
    );
  }
}
