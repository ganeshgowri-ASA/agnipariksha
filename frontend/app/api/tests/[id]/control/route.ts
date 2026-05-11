import { NextResponse } from 'next/server';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

const ALLOWED_ACTIONS = new Set([
  'start', 'pause', 'resume', 'stop', 'emergency_stop',
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  let body: { action?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const action = body.action;
  if (!action || !ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: `Unknown action; expected one of ${[...ALLOWED_ACTIONS].join(', ')}` },
      { status: 400 },
    );
  }

  // Best-effort proxy to backend; never block the UI on backend availability.
  try {
    const upstream = await fetch(
      `${BACKEND_BASE}/api/tests/${encodeURIComponent(id)}/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      },
    );
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { id, action, accepted: true, mode: 'demo' },
      { status: 202 },
    );
  }
}
