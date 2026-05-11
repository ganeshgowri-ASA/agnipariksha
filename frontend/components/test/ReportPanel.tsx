'use client';

import { useState } from 'react';
import type { TestSession } from '@/app/page';
import type { ModuleSpec, TestSchema } from '@/lib/testSchemas';
import { downloadReport } from '@/lib/testApi';

interface ReportPanelProps {
  schema: TestSchema;
  session: TestSession | null;
  module: ModuleSpec;
}

function summarise(session: TestSession | null) {
  if (!session) return null;
  const n = session.readings.length;
  if (n === 0) {
    return {
      count: 0,
      avgV: 0,
      avgI: 0,
      avgP: 0,
      minV: 0,
      maxV: 0,
      durationMin: 0,
    };
  }
  let sumV = 0;
  let sumI = 0;
  let sumP = 0;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const r of session.readings) {
    sumV += r.voltage;
    sumI += r.current;
    sumP += r.power;
    if (r.voltage < minV) minV = r.voltage;
    if (r.voltage > maxV) maxV = r.voltage;
  }
  const endTime = session.endTime ?? Date.now();
  return {
    count: n,
    avgV: sumV / n,
    avgI: sumI / n,
    avgP: sumP / n,
    minV,
    maxV,
    durationMin: (endTime - session.startTime) / 60000,
  };
}

type Status = 'idle' | 'word' | 'pdf';

export default function ReportPanel({ schema, session, module }: ReportPanelProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const summary = summarise(session);

  const verdict = session?.result ?? null;
  const verdictClass =
    verdict === 'PASS'
      ? 'bg-green-900/40 text-green-300 border-green-700/50'
      : verdict === 'FAIL'
        ? 'bg-red-900/40 text-red-300 border-red-700/50'
        : 'bg-gray-800/40 text-gray-400 border-gray-700/50';

  const onGenerate = async (format: 'word' | 'pdf') => {
    if (!session) return;
    setStatus(format);
    setLastError(null);
    const ext = format === 'word' ? 'docx' : 'pdf';
    const fileName = `${schema.id}_${session.id}.${ext}`;
    const served = await downloadReport(session.id, format, fileName);
    if (!served) {
      setLastError(
        `Backend report endpoint unavailable (GET /api/reports/${session.id}/${format}).`,
      );
    }
    setStatus('idle');
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-gray-200 mb-1">Report Header</h3>
        <p className="text-xs text-gray-400 mb-3">
          Reported per <span className="font-mono">{schema.standard}</span>,
          clause <span className="font-mono">{schema.clause}</span>.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          <div>
            <span className="text-gray-500">Sample ID:</span>{' '}
            <span className="text-gray-200">{module.sampleId || '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Pmax:</span>{' '}
            <span className="text-gray-200">{module.pmax} W</span>
          </div>
          <div>
            <span className="text-gray-500">Voc / Isc:</span>{' '}
            <span className="text-gray-200">
              {module.voc} V / {module.isc} A
            </span>
          </div>
          <div>
            <span className="text-gray-500">Session:</span>{' '}
            <span className="font-mono text-gray-300">{session?.id ?? '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Started:</span>{' '}
            <span className="text-gray-200">
              {session ? new Date(session.startTime).toLocaleString() : '—'}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Duration:</span>{' '}
            <span className="text-gray-200">
              {summary ? summary.durationMin.toFixed(1) : '—'} min
            </span>
          </div>
        </div>
      </div>

      <div className={`rounded-lg border p-4 ${verdictClass}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider opacity-80">
              Pass / Fail
            </p>
            <p className="text-2xl font-bold mt-1">
              {verdict ?? (session ? 'IN PROGRESS' : 'NOT STARTED')}
            </p>
          </div>
          <div className="text-right text-xs leading-relaxed max-w-xs">
            <p className="opacity-80">{schema.passFailHint}</p>
          </div>
        </div>
      </div>

      {summary && (
        <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
          <h3 className="text-sm font-bold text-gray-200 mb-3">Measurement Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { l: 'Samples', v: summary.count.toLocaleString(), u: '' },
              { l: 'Avg V', v: summary.avgV.toFixed(3), u: 'V' },
              { l: 'Avg I', v: summary.avgI.toFixed(3), u: 'A' },
              { l: 'Avg P', v: summary.avgP.toFixed(3), u: 'W' },
              { l: 'V min', v: summary.minV.toFixed(3), u: 'V' },
              { l: 'V max', v: summary.maxV.toFixed(3), u: 'V' },
              { l: 'Duration', v: summary.durationMin.toFixed(1), u: 'min' },
            ].map((s) => (
              <div
                key={s.l}
                className="bg-gray-800 rounded p-2 border border-gray-700"
              >
                <p className="text-xs text-gray-500">{s.l}</p>
                <p className="text-lg font-mono font-bold text-white">
                  {s.v}
                  <span className="text-xs font-normal text-gray-400 ml-1">
                    {s.u}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => onGenerate('word')}
          disabled={!session || status !== 'idle'}
          className="flex-1 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-sm rounded font-medium transition-colors"
        >
          {status === 'word' ? '⏳ Fetching…' : '📝 Generate Word'}
        </button>
        <button
          onClick={() => onGenerate('pdf')}
          disabled={!session || status !== 'idle'}
          className="flex-1 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-sm rounded font-medium transition-colors"
        >
          {status === 'pdf' ? '⏳ Fetching…' : '📄 Generate PDF'}
        </button>
      </div>
      {lastError && (
        <p className="text-xs text-yellow-400">
          ⚠ {lastError} Report generation must be served by the backend at{' '}
          <span className="font-mono">/api/reports/&lt;session&gt;/&lt;fmt&gt;</span>.
        </p>
      )}
    </div>
  );
}
