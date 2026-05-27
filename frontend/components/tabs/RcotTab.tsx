'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldAlert, Play, RotateCcw } from 'lucide-react';
import type { TestSession, LiveReading } from '@/types/test-session';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

// Mirrors backend/app/rcot.py demo synthesis: Tj ramps ambient -> ambient+55 C
// over the soak; the run aborts the moment Tj exceeds the abort threshold.
const PEAK_RISE_C = 55;
const STEP_S = 10;
type Phase = 'idle' | 'running' | 'done' | 'aborted';

function buildSeries(ambient: number, durationH: number, tjAbort: number) {
  const total = durationH * 3600;
  const samples: Array<{ t: number; temp: number }> = [];
  let aborted = false;
  for (let i = 0; i <= Math.floor(total / STEP_S); i++) {
    const t = i * STEP_S;
    const temp = +(ambient + PEAK_RISE_C * Math.min(1, t / total) + (Math.random() - 0.5) * 1.6).toFixed(2);
    samples.push({ t, temp });
    if (temp > tjAbort) { aborted = true; break; }
  }
  return { samples, aborted };
}

export default function RcotTab({ session, onSessionUpdate, demoMode }: Props) {
  const [fuse, setFuse] = useState(10);
  const [duration, setDuration] = useState(2.0);
  const [ambient, setAmbient] = useState(40);
  const [tjAbort, setTjAbort] = useState(200);
  const [owner, setOwner] = useState(false);
  const [estop, setEstop] = useState(false);
  const [manualOk, setManualOk] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [temp, setTemp] = useState<number | null>(null);
  const [peak, setPeak] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const meta = useRef({ id: '', start: 0 });

  const testCurrent = +(fuse * 1.35).toFixed(3);
  const canStart = demoMode && owner && estop && phase !== 'running';
  const verdict = phase === 'aborted' ? 'FAIL' : phase === 'done' && manualOk ? 'PASS' : 'UNKNOWN';
  const vColor = verdict === 'PASS' ? 'text-green-400' : verdict === 'FAIL' ? 'text-red-400' : 'text-gray-400';

  const stop = useCallback(() => { if (timer.current) clearInterval(timer.current); timer.current = null; }, []);
  useEffect(() => stop, [stop]);

  const pushSession = useCallback((status: TestSession['status'], result?: 'PASS' | 'FAIL') => {
    onSessionUpdate({ id: meta.current.id, testType: 'rcot', startTime: meta.current.start, status, readings: [], result, iecClause: 'MST 26' });
  }, [onSessionUpdate]);

  const onStart = useCallback(() => {
    if (!canStart) return;
    stop();
    const { samples, aborted } = buildSeries(ambient, duration, tjAbort);
    meta.current = { id: `RCOT-${Date.now()}`, start: Date.now() };
    setPhase('running'); setManualOk(false); setPeak(ambient); setElapsed(0); setTemp(ambient);
    pushSession('running');
    let i = 0;
    timer.current = setInterval(() => {
      const s = samples[i];
      setTemp(s.temp); setElapsed(s.t); setPeak(p => Math.max(p, s.temp));
      if (i >= samples.length - 1) {
        stop();
        if (aborted) { setPhase('aborted'); pushSession('fail', 'FAIL'); }
        else { setPhase('done'); pushSession('paused'); }
      }
      i++;
    }, Math.max(16, Math.round(8000 / samples.length)));
  }, [canStart, ambient, duration, tjAbort, pushSession, stop]);

  const onReset = useCallback(() => {
    stop(); setPhase('idle'); setTemp(null); setPeak(0); setElapsed(0); setManualOk(false);
    onSessionUpdate(null);
  }, [stop, onSessionUpdate]);

  const onManual = (v: boolean) => {
    setManualOk(v);
    if (phase === 'done') pushSession(v ? 'pass' : 'paused', v ? 'PASS' : undefined);
  };

  const fields: Array<[string, number, (n: number) => void, number, number, number]> = [
    ['Max series fuse (A)', fuse, setFuse, 5, 30, 0.5],
    ['Duration (h)', duration, setDuration, 1, 2.5, 0.1],
    ['Ambient (°C)', ambient, setAmbient, 40, 90, 1],
    ['Tj abort (°C)', tjAbort, setTjAbort, 60, 300, 5],
  ];

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-auto p-4 gap-4" data-testid="test-tab-rcot">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-bold text-rose-400">RCOT Reverse Current Overload</span>
        <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded">IEC 61730-2 MST 26</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${demoMode ? 'bg-yellow-900/40 text-yellow-300' : 'bg-red-900/50 text-red-200'}`}>
          {demoMode ? 'DEMO' : 'LIVE BLOCKED'}
        </span>
        {phase !== 'idle' && <span className={`text-xs font-bold ${vColor}`} data-testid="rcot-verdict">● {verdict}</span>}
      </div>

      {!demoMode && (
        <div className="rounded-lg border border-red-700/60 bg-red-900/20 p-3 flex gap-2" data-testid="rcot-live-blocked">
          <ShieldAlert className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
          <p className="text-xs text-red-200">
            <strong>LIVE RCOT is hard-blocked.</strong> Reverse-biasing at 135 % of fuse rating is a fire hazard;
            a live run needs a verified reverse-polarity PSU driver, K-type thermocouples, owner at bench, and an
            audited E-stop. Switch to DEMO to simulate. See SAFETY.md.
          </p>
        </div>
      )}

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 max-w-2xl space-y-3">
        <h3 className="text-sm font-bold text-rose-400">Setup — 135 % fuse-rating overload</h3>
        <div className="grid grid-cols-2 gap-3">
          {fields.map(([label, v, set, min, max, step]) => (
            <div key={label}>
              <label className="text-xs text-gray-400 block mb-1">{label}</label>
              <input type="number" value={v} min={min} max={max} step={step} disabled={phase === 'running'}
                onChange={e => set(Number(e.target.value))}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 disabled:opacity-50" />
            </div>
          ))}
          <div className="col-span-2">
            <label className="text-xs text-gray-400 block mb-1">Test current = 1.35 × fuse (locked)</label>
            <input type="text" readOnly value={`${testCurrent} A`} data-testid="rcot-test-current"
              className="w-full bg-gray-950 border border-rose-700/50 rounded px-2 py-1.5 text-xs text-rose-300 font-mono" />
          </div>
        </div>
        {([['owner', owner, setOwner, 'Owner physically at bench'], ['estop', estop, setEstop, 'E-stop wired & verified']] as const).map(([k, val, setv, lbl]) => (
          <label key={k} className="flex items-center gap-2 text-xs text-gray-300">
            <input type="checkbox" checked={val} onChange={e => setv(e.target.checked)} data-testid={`rcot-ack-${k}`} className="accent-rose-500" />
            {lbl} <span className="text-red-400">*required even in DEMO</span>
          </label>
        ))}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onStart} disabled={!canStart} data-testid="rcot-start"
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white rounded bg-rose-700 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed">
            <Play className="w-3.5 h-3.5" /> Start (DEMO)
          </button>
          <button type="button" onClick={onReset}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-gray-200 rounded bg-gray-700 hover:bg-gray-600">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
        </div>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 max-w-2xl space-y-3 text-xs">
        <div className="flex gap-6 font-mono text-gray-300">
          <span>Tj now: <b className="text-white">{temp === null ? '—' : `${temp} °C`}</b></span>
          <span>Peak: <b className="text-white">{peak ? `${peak.toFixed(1)} °C` : '—'}</b></span>
          <span>Elapsed: <b className="text-white">{Math.floor(elapsed / 3600)}h {Math.floor((elapsed % 3600) / 60)}m</b></span>
        </div>
        {phase === 'aborted' && (
          <p className="text-red-300" data-testid="rcot-abort">ABORTED — Tj exceeded {tjAbort} °C. Conclusive FAIL (thermal runaway).</p>
        )}
        <div className="flex items-center justify-between gap-3 flex-wrap border-t border-gray-800 pt-3">
          <label className={`flex items-center gap-2 ${phase === 'done' ? 'text-gray-200' : 'text-gray-600'}`}>
            <input type="checkbox" checked={manualOk} disabled={phase !== 'done'} data-testid="rcot-manual-ok"
              onChange={e => onManual(e.target.checked)} className="accent-green-500" />
            Post-test: no flame, melting, cracking observed
          </label>
          <span className={`text-sm font-bold ${vColor}`}>Verdict: {verdict}</span>
        </div>
      </div>
    </div>
  );
}
