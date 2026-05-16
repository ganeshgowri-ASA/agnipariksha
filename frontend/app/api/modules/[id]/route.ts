import { NextResponse } from 'next/server';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

/**
 * Demo catalogue used when the FastAPI backend is unreachable (Playwright
 * E2E, dev environments without the DB stack running). Mirrors the shape
 * of backend/app/modules_api.py so the UI can rely on a stable contract.
 */
const DEMO_CATALOGUE: Record<
  string,
  {
    id: string;
    model: string;
    manufacturer: string;
    pmax_w: number;
    voc_v: number;
    isc_a: number;
    vmpp_v: number;
    impp_a: number;
  }
> = {
  'MOD-2026-001': {
    id: 'MOD-2026-001',
    model: 'Vikram Solar Somera 540M',
    manufacturer: 'Vikram Solar',
    pmax_w: 540,
    voc_v: 49.5,
    isc_a: 13.85,
    vmpp_v: 41.6,
    impp_a: 12.99,
  },
  'MOD-2026-002': {
    id: 'MOD-2026-002',
    model: 'Adani ASMS-540-144M',
    manufacturer: 'Adani Solar',
    pmax_w: 540,
    voc_v: 49.7,
    isc_a: 13.92,
    vmpp_v: 41.5,
    impp_a: 13.02,
  },
  'MOD-2026-003': {
    id: 'MOD-2026-003',
    model: 'Waaree Aditya 545W',
    manufacturer: 'Waaree Energies',
    pmax_w: 545,
    voc_v: 49.8,
    isc_a: 13.95,
    vmpp_v: 41.7,
    impp_a: 13.08,
  },
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const trimmed = id.trim();
  if (!trimmed) {
    return NextResponse.json({ error: 'module id required' }, { status: 400 });
  }

  try {
    const upstream = await fetch(
      `${BACKEND_BASE}/api/modules/${encodeURIComponent(trimmed)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(2500) },
    );
    if (upstream.status === 404) {
      const fallback = DEMO_CATALOGUE[trimmed];
      if (fallback) {
        return NextResponse.json(fallback, { status: 200 });
      }
      return NextResponse.json({ error: 'module not found' }, { status: 404 });
    }
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        'Content-Type':
          upstream.headers.get('content-type') ?? 'application/json',
      },
    });
  } catch {
    // Backend unreachable — serve the bundled demo catalogue so the Setup
    // tab and E2E suites can validate IDs without the FastAPI stack.
    const fallback = DEMO_CATALOGUE[trimmed];
    if (fallback) {
      return NextResponse.json(fallback, { status: 200 });
    }
    return NextResponse.json(
      { error: 'module not found', mode: 'demo' },
      { status: 404 },
    );
  }
}
