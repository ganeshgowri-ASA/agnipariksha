import { NextResponse } from 'next/server';
import { transitionTicket } from '@/lib/tickets-store';
import type { TicketState } from '@/lib/tickets-types';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';
const TIMEOUT_MS = 1500;

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    to?: TicketState;
    note?: string;
  };
  try {
    const upstream = await fetch(
      `${BACKEND_BASE}/api/tickets/${encodeURIComponent(id)}/transition`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (upstream.ok || upstream.status === 404 || upstream.status === 409) {
      return new NextResponse(await upstream.text(), {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {
    /* fall through */
  }
  if (!body.to) {
    return NextResponse.json({ error: 'missing_to' }, { status: 422 });
  }
  try {
    const t = transitionTicket(id, body.to, body.note);
    if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(t);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'invalid' },
      { status: 409 },
    );
  }
}
