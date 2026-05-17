import { NextResponse } from 'next/server';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

// In-memory fallback so the UI works when the FastAPI backend is down.
// This is intentionally NOT shared with the streaming route — the demo
// stream there persists its own transcript through the same store.
import { fallbackStore } from '../_fallback';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  context: { params: Promise<{ moduleId: string }> },
): Promise<Response> {
  const { moduleId } = await context.params;
  const id = decodeURIComponent(moduleId);
  try {
    const r = await fetch(
      `${BACKEND_BASE}/api/assistant/threads/${encodeURIComponent(id)}`,
      { cache: 'no-store' },
    );
    if (r.ok) {
      const body = await r.text();
      return new NextResponse(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {
    /* fall through to in-process store */
  }
  return NextResponse.json(fallbackStore.read(id));
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ moduleId: string }> },
): Promise<Response> {
  const { moduleId } = await context.params;
  const id = decodeURIComponent(moduleId);
  try {
    const r = await fetch(
      `${BACKEND_BASE}/api/assistant/threads/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    if (r.ok || r.status === 204) {
      fallbackStore.clear(id);
      return new NextResponse(null, { status: 204 });
    }
  } catch {
    /* fall through */
  }
  fallbackStore.clear(id);
  return new NextResponse(null, { status: 204 });
}
