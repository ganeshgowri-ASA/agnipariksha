/**
 * G17 — IV capture template downloads.
 *   GET /api/iv/4q/template         → JSON  (4-Quadrant SMU)
 *   GET /api/iv/psu-scope/template  → JSON  (PSU + Oscilloscope)
 *   GET /api/iv/import/template     → XLSX  (Offline Import)
 * XLSX is an embedded minimal-but-valid empty workbook; operators fill it
 * in offline and re-upload via the Setup tab.
 */
import { NextResponse } from 'next/server';

const FOUR_Q_TEMPLATE = {
  schema: 'agnipariksha.iv.4q.v1',
  smu: {
    quadrants: 4,
    vMin: -10,
    vMax: 10,
    vStep: 0.05,
    iLimit: 1.5,
    settleMs: 5,
  },
  sweep: [
    { phase: 'forward', direction: 'V- to V+' },
    { phase: 'reverse', direction: 'V+ to V-' },
  ],
  output: { psu: 'off' },
};

const PSU_SCOPE_TEMPLATE = {
  schema: 'agnipariksha.iv.psu-scope.v1',
  psu: { voc: 60, isc: 10, rampSecs: 12, outputArmed: false },
  scope: {
    channels: ['V', 'I'],
    sampleHz: 5000,
    durationMs: 12_000,
    trigger: 'manual',
  },
  capture: { format: 'wss', ackEverySamples: 100 },
  output: { psu: 'off' },
};

// Minimal valid XLSX container, base64-embedded so the route stays
// dependency-free. Operators fill it in offline.
const IMPORT_XLSX_BASE64 =
  'UEsDBBQAAAAIAAAAIQDfpNJsTwEAAJQEAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbK2UTU' +
  '7DMBCF90jcwfIWxQ5dIIJSlhSiZBAuYDuTYjW2I9tNFFTYI3AzbsA4P0BREZFSiSyiTOY9z3uT' +
  'zKVS73XFdkBOlubMD/wRZ0glplQzNHm6Hl8wgZTHJUKGGvbNcZf6dHF8d9pZ49ZSRl5IZW5Ar' +
  'JwxKAk0jx1aIYJk6vIeoa66twLAhcG5JpQ4bC7BkA1nMTMjjFLrYwOoTIETgNVuQI+3VV6Bzh' +
  '9TZbBSj6CY7oFlVjUgIuTAQFlFkN+SiAmS0w1V0AMQrhmiyvE0a/Q8eAjJ8eAk83/V+IjGYNH' +
  'r8bZuwUbS7tjLwTtFi/jpyAm4Yyf+VS7HQYnQDLi0g4LTzZ+CIdiX1+E4yJ7Pl15+rN3yhYxAUL' +
  'PQzgflE7vUHzfeS9XjpO1AMz9C/8a3UbnwgVPL4FwiBVBLAQItABQAAAAIAAAAIQDfpNJsTwEAAJ' +
  'QEAAATAAAAAAAAAAAAAAAAAAAAAABbQ29udGVudF9UeXBlc10ueG1sUEsFBgAAAAABAAEAQQAAAH' +
  'gBAAAAAA==';

interface RouteContext {
  params: Promise<{ type: string }>;
}

export async function GET(_req: Request, context: RouteContext): Promise<Response> {
  const { type } = await context.params;

  if (type === '4q') {
    return NextResponse.json(FOUR_Q_TEMPLATE, {
      headers: { 'Content-Disposition': 'attachment; filename="iv-template-4q.json"' },
    });
  }
  if (type === 'psu-scope') {
    return NextResponse.json(PSU_SCOPE_TEMPLATE, {
      headers: { 'Content-Disposition': 'attachment; filename="iv-template-psu-scope.json"' },
    });
  }
  if (type === 'import') {
    const buf = Buffer.from(IMPORT_XLSX_BASE64, 'base64');
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="iv-template-import.xlsx"',
      },
    });
  }

  return NextResponse.json({ error: `unknown iv template ${type}` }, { status: 404 });
}
