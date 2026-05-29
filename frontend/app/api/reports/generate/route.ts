import { NextResponse } from 'next/server';

/**
 * POST /api/reports/generate
 *
 * Strategy:
 *   1. Forward the session payload to the backend ReportLab pipeline at
 *      ``${BACKEND_HTTP_URL}/api/reports/generate``. The backend returns
 *      a multi-section IEC PDF with proper charts, KPIs, CSV appendix,
 *      and Operator/Customer/Equipment metadata stamped onto the
 *      TestSession via stampOperatorContext().
 *   2. If the backend is unreachable (offline lab, DEMO with no API
 *      running, or the operator is using the Vercel preview without a
 *      backend deployment) we fall back to a tiny text-only PDF built
 *      in this Node route. The fallback is intentionally minimal —
 *      operators see "(degraded report)" so they know to retry once
 *      the backend is back online.
 *
 * The fallback path also services the CI smoke test which exercises
 * this URL without bringing up a backend.
 */

const BACKEND_URL =
  process.env.BACKEND_HTTP_URL ||
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ||
  '';

function escapePdfString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/** Build a tiny but spec-valid PDF — fallback when backend is unreachable. */
function buildMinimalPdf(lines: string[]): Buffer {
  const header = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';

  const obj1 = '1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n';
  const obj2 = '2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n';

  const contentParts: string[] = ['BT', '/F1 12 Tf'];
  let y = 740;
  for (const line of lines) {
    contentParts.push(`1 0 0 1 60 ${y} Tm`);
    contentParts.push(`(${escapePdfString(line)}) Tj`);
    y -= 18;
  }
  contentParts.push('ET');
  const content = contentParts.join('\n') + '\n';
  const contentLen = Buffer.byteLength(content, 'latin1');

  const obj4 = `4 0 obj\n<</Length ${contentLen}>>\nstream\n${content}endstream\nendobj\n`;
  const obj3 =
    '3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
    '/Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>\nendobj\n';
  const obj5 = '5 0 obj\n<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>\nendobj\n';

  const len = (s: string) => Buffer.byteLength(s, 'latin1');
  let cursor = len(header);
  const off1 = cursor; cursor += len(obj1);
  const off2 = cursor; cursor += len(obj2);
  const off3 = cursor; cursor += len(obj3);
  const off4 = cursor; cursor += len(obj4);
  const off5 = cursor; cursor += len(obj5);
  const xrefOffset = cursor;

  const pad = (n: number): string => n.toString().padStart(10, '0');
  const xref =
    'xref\n' +
    '0 6\n' +
    '0000000000 65535 f \n' +
    `${pad(off1)} 00000 n \n` +
    `${pad(off2)} 00000 n \n` +
    `${pad(off3)} 00000 n \n` +
    `${pad(off4)} 00000 n \n` +
    `${pad(off5)} 00000 n \n` +
    'trailer\n' +
    '<</Size 6 /Root 1 0 R>>\n' +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.concat([
    Buffer.from(header, 'latin1'),
    Buffer.from(obj1, 'latin1'),
    Buffer.from(obj2, 'latin1'),
    Buffer.from(obj3, 'latin1'),
    Buffer.from(obj4, 'latin1'),
    Buffer.from(obj5, 'latin1'),
    Buffer.from(xref, 'latin1'),
  ]);
}

interface ReportPayload {
  id?: string;
  testType?: string;
  result?: string;
  operatorName?: string;
  customerName?: string;
  moduleSerial?: string;
  status?: string;
  [k: string]: unknown;
}

export async function POST(req: Request): Promise<Response> {
  let payload: ReportPayload;
  try {
    payload = (await req.json()) as ReportPayload;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!payload || typeof payload !== 'object' || !payload.id) {
    return NextResponse.json({ error: 'payload requires at least an `id` field' }, { status: 400 });
  }

  // 1) Try the backend ReportLab pipeline first.
  if (BACKEND_URL) {
    try {
      const upstream = await fetch(`${BACKEND_URL.replace(/\/$/, '')}/api/reports/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        // Short timeout — if the backend is slow we fall back to text-only
        // so the operator gets *some* PDF instead of a stuck spinner.
        signal: AbortSignal.timeout(8_000),
      });
      if (upstream.ok) {
        const ab = await upstream.arrayBuffer();
        const filename = `${payload.id ?? 'session'}-iec-report.pdf`;
        return new Response(ab, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'X-Report-Source': 'backend-reportlab',
          },
        });
      }
      // Non-OK upstream — log via header and fall through to fallback.
    } catch {
      // Upstream unreachable / timed out — fall through.
    }
  }

  // 2) Fallback: minimal text-only PDF so the UI always succeeds.
  const lines = [
    'Agnipariksha IEC Test Report (degraded)',
    `Session ID:   ${payload.id ?? '-'}`,
    `Test type:    ${payload.testType ?? '-'}`,
    `Result:       ${(payload.result ?? payload.status ?? '-').toString().toUpperCase()}`,
    `Operator:     ${payload.operatorName ?? 'Anonymous'}`,
    `Customer:     ${payload.customerName ?? '-'}`,
    `Module SN:    ${payload.moduleSerial ?? '-'}`,
    `Generated:    ${new Date().toISOString()}`,
    '',
    '(backend PDF builder unreachable - showing minimal fallback)',
  ];
  const pdf = buildMinimalPdf(lines);
  const filename = `${payload.id ?? 'session'}-iec-report.pdf`;
  // `Response` expects BodyInit; in Next.js's Node runtime we pass a
  // typed array view of the Buffer so the TS Response type accepts it.
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Report-Source': 'frontend-fallback',
    },
  });
}
