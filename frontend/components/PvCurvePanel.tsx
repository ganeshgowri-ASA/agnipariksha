'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { API_BASE } from '@/lib/apiBase';

interface IvPoint { v: number; i: number; p: number }
interface IvCurve {
  module: string;
  isc: number; voc: number; imp: number; vmp: number;
  mpp: IvPoint;
  operating_point: IvPoint;
  curve: IvPoint[];
}

/**
 * PV array-simulator view for the DEMO PSU: shows the module I-V curve, the
 * maximum-power point, and the live operating point, plus a toggle that
 * switches the backend source between a plain bench supply and PV-curve mode.
 * All DEMO — no hardware energization.
 */
export default function PvCurvePanel() {
  const [iv, setIv] = useState<IvCurve | null>(null);
  const [source, setSource] = useState<'psu' | 'pv'>('psu');
  const [err, setErr] = useState<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const [ivRes, stateRes] = await Promise.all([
        fetch(`${API_BASE}/api/opcua/psu/iv`),
        fetch(`${API_BASE}/api/opcua/psu`),
      ]);
      if (!ivRes.ok || !stateRes.ok) throw new Error('backend');
      setIv(await ivRes.json());
      setSource((await stateRes.json()).source);
      setErr(null);
    } catch {
      setErr('backend not reachable');
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), 1000);
    return () => clearInterval(id);
  }, [poll]);

  const setMode = async (mode: 'psu' | 'pv') => {
    setSource(mode);
    try {
      await fetch(`${API_BASE}/api/opcua/psu/source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
    } catch { /* poll surfaces errors */ }
  };

  return (
    <div className="space-y-3 rounded-xl border border-app bg-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-amber-500">PV array simulator — I-V curve</h3>
          <p className="text-xs text-muted">{iv?.module ?? 'module'} · emulated in DEMO</p>
        </div>
        <div className="inline-flex rounded border border-app overflow-hidden text-xs">
          <button
            onClick={() => setMode('psu')}
            className={`px-3 py-1 ${source === 'psu' ? 'bg-surface-2 text-app font-semibold' : 'text-muted'}`}
          >
            Bench PSU
          </button>
          <button
            onClick={() => setMode('pv')}
            className={`px-3 py-1 ${source === 'pv' ? 'bg-surface-2 text-app font-semibold' : 'text-muted'}`}
          >
            PV module
          </button>
        </div>
      </div>

      {err && <div className="text-xs text-red-500">{err}</div>}

      {iv && (
        <>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={iv.curve} margin={{ top: 8, right: 16, bottom: 18, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="v" type="number" domain={[0, Math.ceil(iv.voc)]}
                  tick={{ fontSize: 10 }} stroke="var(--muted)"
                  label={{ value: 'V (V)', position: 'insideBottom', offset: -8, fontSize: 10 }}
                />
                <YAxis
                  dataKey="i" type="number" domain={[0, Math.ceil(iv.isc)]}
                  tick={{ fontSize: 10 }} stroke="var(--muted)"
                  label={{ value: 'I (A)', angle: -90, position: 'insideLeft', fontSize: 10 }}
                />
                <Tooltip
                  formatter={(val: number, name) => [val.toFixed(3), name === 'i' ? 'I (A)' : name]}
                  labelFormatter={(v) => `${Number(v).toFixed(1)} V`}
                />
                <Line dataKey="i" stroke="#f59e0b" dot={false} strokeWidth={2} isAnimationActive={false} />
                <ReferenceDot x={iv.mpp.v} y={iv.mpp.i} r={4} fill="#10b981" stroke="none" />
                {source === 'pv' && iv.operating_point.i > 0 && (
                  <Scatter data={[iv.operating_point]} dataKey="i" fill="#ef4444" />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <Stat label="Isc" value={`${iv.isc.toFixed(2)} A`} />
            <Stat label="Voc" value={`${iv.voc.toFixed(1)} V`} />
            <Stat label="MPP" value={`${iv.mpp.v.toFixed(1)} V · ${iv.mpp.i.toFixed(2)} A`} accent="text-emerald-500" />
            <Stat
              label="Operating"
              value={source === 'pv' ? `${iv.operating_point.v.toFixed(1)} V · ${iv.operating_point.i.toFixed(2)} A` : '— (bench PSU)'}
              accent="text-red-500"
            />
          </div>
          <p className="text-[11px] text-muted">
            In <b>PV module</b> mode the current follows the module curve for the
            voltage you set above — set V near {iv.vmp.toFixed(0)} V (MPP) and watch
            the red operating point ride toward the knee. Bench-PSU mode ignores the
            curve. All simulated; no hardware energized.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded bg-surface-2 border border-app p-2">
      <div className="text-[9px] uppercase text-muted">{label}</div>
      <div className={`font-mono ${accent ?? 'text-app'}`}>{value}</div>
    </div>
  );
}
