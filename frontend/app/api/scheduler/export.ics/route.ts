const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/scheduler/export.ics${url.search}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'text/calendar; charset=utf-8',
        'Content-Disposition':
          upstream.headers.get('content-disposition') ??
          'attachment; filename="agnipariksha-schedule.ics"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'backend_unreachable', message: e instanceof Error ? e.message : String(e) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
