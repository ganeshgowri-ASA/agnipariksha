import { NextResponse } from 'next/server';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/scheduler/next-slot${url.search}`, {
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
