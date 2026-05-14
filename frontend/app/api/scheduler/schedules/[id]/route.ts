import { NextResponse } from 'next/server';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  const payload = await request.json().catch(() => ({}));
  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/scheduler/schedules/${id}`, {
      method: 'PATCH',
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

export async function DELETE(_request: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/scheduler/schedules/${id}`, {
      method: 'DELETE',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (upstream.status === 204) {
      return new NextResponse(null, { status: 204 });
    }
    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
  } catch (e) {
    return NextResponse.json(
      { error: 'backend_unreachable', message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
