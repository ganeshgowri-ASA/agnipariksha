import { NextResponse } from 'next/server';

function escapePdfString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Build a tiny but spec-valid PDF (single page, Helvetica) so demo-mode
 * report downloads work without a heavyweight server-side PDF lib.
 * Production reports are generated client-side via jspdf in
 * components/ReportGenerator.tsx; this endpoint exists so external tooling
 * (CI smoke tests, the "Quick export" header button) has a stable URL.
 */
function buildMinimalPdf(lines: string[]): Buffer {
  const header = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';

  const obj1 = '1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n';
  const obj2 = '2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n';

  const contentParts: string[] = ['BT', '/F1 14 Tf'];
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
    `startxref\n${xrefOffset}\n` +
    '%%EOF\n';

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

interface GenerateBody {
  testId?: string;
  testName?: string;
  standard?: string;
  operator?: string;
  moduleId?: string;
  result?: string;
  format?: 'pdf';
}

export async function POST(request: Request): Promise<Response> {
  let body: GenerateBody = {};
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    /* empty body is allowed; demo report */
  }

  const now = new Date().toISOString();
  const lines = [
    'AGNIPARIKSHA — PV Module Reliability Report',
    '------------------------------------------',
    `Generated:  ${now}`,
    `Test ID:    ${body.testId    ?? 'demo-stub'}`,
    `Test:       ${body.testName  ?? 'Demo Stub'}`,
    `Standard:   ${body.standard  ?? 'IEC 61215-2'}`,
    `Module ID:  ${body.moduleId  ?? 'N/A'}`,
    `Operator:   ${body.operator  ?? 'demo'}`,
    `Result:     ${body.result    ?? 'PASS'}`,
    '',
    'This is a server-rendered demo stub. Use the in-app',
    'Report tab (jspdf + docx) for full reports with charts.',
  ];

  const pdf = buildMinimalPdf(lines);
  const safe = (body.testId ?? 'demo').replace(/[^A-Za-z0-9_.-]+/g, '_');

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': pdf.length.toString(),
      'Content-Disposition': `attachment; filename="agnipariksha-${safe}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}

export function GET(): Response {
  return NextResponse.json(
    { error: 'POST only', example: { testId: 'demo', format: 'pdf' } },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
