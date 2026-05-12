import { NextResponse } from 'next/server';
import { getTicket, patchTicket } from '@/lib/tickets-store';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';
const TIMEOUT_MS = 1500;

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/tickets/${encodeURIComponent(id)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (upstream.ok) {
      return new NextResponse(await upstream.text(), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {
    /* fall through */
  }
  const t = getTicket(id);
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(t);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/tickets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (upstream.ok || upstream.status === 404 || upstream.status === 409) {
      return new NextResponse(await upstream.text(), {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {
    /* fall through */
  }
  try {
    const t = patchTicket(id, body);
    if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(t);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'invalid' },
      { status: 409 },
    );
  }
}
