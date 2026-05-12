import { NextResponse } from 'next/server';
import { listNotifications } from '@/lib/tickets-store';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/tickets/_notifications`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
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
  return NextResponse.json({ items: listNotifications() });
}
