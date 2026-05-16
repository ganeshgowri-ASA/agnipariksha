import { NextResponse } from 'next/server';

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000';

export interface ModuleBasicCheck {
  module_id: string;
  status: 'pass' | 'fail' | 'pending' | 'unknown';
  checked_at: string | null;
}

export interface RunsSummary {
  window_hours: 24;
  total_runs: number;
  passed: number;
  failed: number;
  in_flight: number;
  alarms: number;
  pass_rate: number;
  modules: ModuleBasicCheck[];
  demo: boolean;
  generated_at: string;
}

function demoStub(): RunsSummary {
  const now = new Date();
  return {
    window_hours: 24,
    total_runs: 12,
    passed: 10,
    failed: 1,
    in_flight: 1,
    alarms: 0,
    pass_rate: 10 / 11,
    modules: [
      { module_id: 'PV-MOD-001', status: 'pass',    checked_at: new Date(now.getTime() - 3 * 3_600_000).toISOString() },
      { module_id: 'PV-MOD-002', status: 'pass',    checked_at: new Date(now.getTime() - 5 * 3_600_000).toISOString() },
      { module_id: 'PV-MOD-003', status: 'fail',    checked_at: new Date(now.getTime() - 6 * 3_600_000).toISOString() },
      { module_id: 'PV-MOD-004', status: 'pending', checked_at: null },
    ],
    demo: true,
    generated_at: now.toISOString(),
  };
}

export async function GET(): Promise<Response> {
  try {
    const upstream = await fetch(`${BACKEND_BASE}/api/runs/summary`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!upstream.ok) {
      return NextResponse.json(demoStub(), { status: 200 });
    }
    const body = (await upstream.json()) as RunsSummary;
    return NextResponse.json(body, { status: 200 });
  } catch {
    return NextResponse.json(demoStub(), { status: 200 });
  }
}
