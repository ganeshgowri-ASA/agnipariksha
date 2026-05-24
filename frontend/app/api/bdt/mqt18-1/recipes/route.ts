import { NextResponse } from 'next/server';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

// Proxies MQT 18.1 recipe submissions to the FastAPI backend. The backend
// currently returns 501 (persistence lands in a later P-backend PR); we
// forward that verbatim, and also surface 501 when the backend is
// unreachable so the setup form behaves deterministically in dev.
export async function POST(request: Request): Promise<Response> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/bdt/mqt18-1/recipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json(
      {
        detail: 'MQT 18.1 recipe persistence is not implemented yet (P-backend).',
        code: 'not_implemented',
      },
      { status: 501 },
    );
  }
}
