import { describe, it, expect } from 'vitest';
import { POST, GET } from './route';

function mockRequest(body: unknown): Request {
  return new Request('http://localhost/api/reports/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/reports/generate', () => {
  it('returns 200 + application/pdf for a mock session', async () => {
    const res = await POST(mockRequest({
      testId: 'TC-1748500000000',
      testName: 'Thermal Cycling',
      standard: 'IEC 61215-2 MQT 11',
      moduleId: 'MOD-2026-001',
      operator: 'A. Tester',
      result: 'PASS',
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');

    const bytes = Buffer.from(await res.arrayBuffer());
    // Valid PDFs begin with the %PDF- magic and end with the EOF marker.
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.subarray(-6).toString('latin1')).toContain('%%EOF');
  });

  it('still returns a 200 PDF when the body is empty (demo stub)', async () => {
    const res = await POST(new Request('http://localhost/api/reports/generate', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('rejects GET with 405', () => {
    expect(GET().status).toBe(405);
  });
});
