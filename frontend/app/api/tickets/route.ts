import { NextResponse } from 'next/server';
import {
  createTicket,
  listTickets,
} from '@/lib/tickets-store';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';
const TIMEOUT_MS = 1500;

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const u = new URL(request.url);
  const qs = u.searchParams.toString();
  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/tickets${qs ? `?${qs}` : ''}`, {
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
  const items = listTickets({
    type: u.searchParams.get('type'),
    state: u.searchParams.get('state'),
    assignee: u.searchParams.get('assignee'),
    q: u.searchParams.get('q'),
  });
  return NextResponse.json(items);
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (upstream.status === 201 || upstream.status === 200) {
      return new NextResponse(await upstream.text(), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (upstream.status === 422) {
      return new NextResponse(await upstream.text(), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {
    /* fall through */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = createTicket(body as any);
    return NextResponse.json(t, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'invalid' },
      { status: 422 },
    );
  }
}
