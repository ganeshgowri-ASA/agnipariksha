'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useHealth } from '@/hooks/useHealth';
import StatusTower from './StatusTower';
import type { LampState } from './StatusLamp';

/**
 * Preflight / manual-functionality view shown BEFORE the cyclic Thermal
 * Cycling test ramps. The Status Tower at the top makes readiness
 * obvious; if any lamp is red, the operator cannot proceed.
 *
 * No new top-level routes — this lives inside the Thermal Cycling tab
 * (it's rendered by TestTabLayout when basicCheckPanel is provided).
 */

interface TransportInfo {
  kind: string;
  host: string;
  port: number;
  demo: boolean;
  reachable: boolean;
  probe_ms: number;
}

interface IdnInfo {
  idn: string;
  demo: boolean;
  host: string;
  port: number;
  error: string | null;
  elapsed_ms: number;
}

interface QueryResult {
  cmd: string;
  response: string;
  elapsed_ms: number;
  demo: boolean;
  error: string | null;
}

interface DevicesPayload {
  devices?: Array<{ id: string; name?: string; health?: { alive?: boolean; state?: string } }>;
  count?: number;
}

interface BasicCheckProps {
  /** Pulled from the parent hook so reads stay in sync with the rest of the tab. */
  wsStatus: string;
  /** Whether the dashboard-wide DEMO toggle is on (header pill). */
  demoMode: boolean;
  /** Module ID — when supplied, auto-POSTs /api/basic-check/pass once
   *  every lamp goes green. Omitted: panel still works manually. */
  moduleId?: string | null;
}

const BACKEND = (process.env.NEXT_PUBLIC_BACKEND_HTTP_URL ?? 'http://localhost:8000').replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Small fetch helpers — all swallow network errors and return null so the
// UI can render a "RESOLVE" lamp instead of crashing.
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string, timeoutMs = 3000): Promise<{ data?: T; error?: string; status?: number }> {
  try {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      return { error: `HTTP ${r.status}`, status: r.status, data: body as T };
    }
    const j = (await r.json()) as T;
    return { data: j, status: r.status };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ThermalCyclingBasicCheck({ wsStatus, demoMode, moduleId }: BasicCheckProps) {
  const health = useHealth(5_000);

  const [transport, setTransport] = useState<TransportInfo | null>(null);
  const [transportErr, setTransportErr] = useState<string | null>(null);
  const [idn, setIdn] = useState<IdnInfo | null>(null);
  const [idnErr, setIdnErr] = useState<string | null>(null);
  const [registry, setRegistry] = useState<DevicesPayload | null>(null);
  const [registryErr, setRegistryErr] = useState<string | null>(null);

  // Operator inputs for the Manual-Set card.
  const [vSet, setVSet] = useState(12.0);
  const [iSet, setISet] = useState(1.0);
  const [output, setOutput] = useState<'on' | 'off' | 'unknown'>('unknown');
  const [readback, setReadback] = useState<{ v?: number; i?: number; p?: number; t?: number; mode?: string; updated?: string }>({});
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [gateOverrides, setGateOverrides] = useState<Record<string, boolean>>({});

  // ---- live polling: transport + idn + device registry ----
  const refreshSCPI = useCallback(async () => {
    const [t, i] = await Promise.all([
      fetchJson<TransportInfo>(`${BACKEND}/api/scpi/transport`),
      fetchJson<IdnInfo>(`${BACKEND}/api/scpi/idn`, 5000),
    ]);
    if (t.data) setTransport(t.data); setTransportErr(t.error ?? null);
    if (i.data) setIdn(i.data); setIdnErr(i.error ?? null);
  }, []);

  const refreshRegistry = useCallback(async () => {
    const r = await fetchJson<DevicesPayload>(`${BACKEND}/api/devices`);
    if (r.data) setRegistry(r.data); setRegistryErr(r.error ?? null);
  }, []);

  useEffect(() => {
    void refreshSCPI();
    void refreshRegistry();
    const t = window.setInterval(() => { void refreshSCPI(); }, 6000);
    const t2 = window.setInterval(() => { void refreshRegistry(); }, 10000);
    return () => { window.clearInterval(t); window.clearInterval(t2); };
  }, [refreshSCPI, refreshRegistry]);

  // ---- derived lamp states ----

  // Backend: green when /api/health reports ok; yellow when degraded;
  // red when down. Registry mismatch demotes green→yellow.
  const backendState: LampState = useMemo(() => {
    if (health.status === 'ok') {
      // Yellow if the device registry is unreachable even though /health is ok
      // (matches the screenshot's "device registry unreachable" banner).
      if (registryErr || (registry && registry.count === 0)) return 'yellow';
      return 'green';
    }
    if (health.status === 'degraded') return 'yellow';
    if (health.status === 'down') return 'red';
    return 'gray';
  }, [health.status, registry, registryErr]);
  const backendDetail = useMemo(() => {
    if (health.status === 'unknown') return 'polling /api/health…';
    const parts = [
      `health=${health.status}`,
      health.version ? `v${health.version}` : null,
      health.scpi_reachable === null ? null : `scpi_reachable=${health.scpi_reachable}`,
      registryErr ? 'registry unreachable' : (registry?.count !== undefined ? `${registry.count} device(s)` : null),
    ].filter(Boolean);
    return parts.join(' · ');
  }, [health, registry, registryErr]);

  // Power Supply: green only when SCPI transport reachable AND *IDN? does
  // not error AND (live mode and idn does not look like a SIM string).
  const powerSupplyState: LampState = useMemo(() => {
    if (!transport && !transportErr) return 'gray';
    if (transportErr) return 'red';
    if (transport && !transport.reachable && !transport.demo) return 'red';
    if (idnErr) return 'red';
    if (idn?.error) return 'red';
    // In live mode, the idn string MUST NOT contain "DEMO" or "SIM" — this
    // is the same fail-fast contract enforced server-side by scpi_router.
    if (idn && !idn.demo && /DEMO|SIM/i.test(idn.idn)) return 'red';
    if (transport?.demo || idn?.demo) return 'yellow'; // demo-mode is "resolve" not "go"
    if (transport?.reachable && idn && idn.idn) return 'green';
    return 'gray';
  }, [transport, transportErr, idn, idnErr]);
  const powerSupplyDetail = useMemo(() => {
    if (transportErr) return `transport check failed: ${transportErr}`;
    if (!transport) return 'probing transport…';
    const tag = transport.demo ? 'DEMO' : 'LIVE';
    const idnStr = idn?.idn ? ` · IDN: ${idn.idn.slice(0, 36)}` : (idnErr ? ` · IDN ERR: ${idnErr}` : '');
    return `${transport.kind} ${transport.host}:${transport.port} · ${tag} · ${transport.reachable ? 'reachable' : 'unreachable'} (${transport.probe_ms} ms)${idnStr}`;
  }, [transport, transportErr, idn, idnErr]);

  // Frontend: yellow if the WebSocket is "demo" or "connecting"; red if
  // "disconnected"; green if "connected". (Hydration mismatch surfaces
  // here too — fixed in StatusBar.)
  const frontendState: LampState = useMemo(() => {
    if (wsStatus === 'connected') return 'green';
    if (wsStatus === 'demo' || wsStatus === 'connecting') return 'yellow';
    if (wsStatus === 'disconnected') return demoMode ? 'yellow' : 'red';
    return 'gray';
  }, [wsStatus, demoMode]);
  const frontendDetail = `ws=${wsStatus}${demoMode ? ' · DEMO toggle ON' : ''}`;

  // Cloud / AI: yellow when unreachable but non-blocking. We probe via
  // /api/ai/ask demo path which returns 200 even without a key. Failure
  // demotes to yellow (not red — AI is never on the critical path).
  const [aiOk, setAiOk] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: 'basic-check ping' }),
          signal: AbortSignal.timeout(3000),
        });
        if (!cancelled) setAiOk(r.ok);
      } catch {
        if (!cancelled) setAiOk(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const cloudAiState: LampState = aiOk === null ? 'gray' : aiOk ? 'green' : 'yellow';
  const cloudAiDetail = aiOk === null ? 'pinging /api/ai/ask…' : aiOk ? 'AI endpoint reachable' : 'AI unavailable — non-blocking';

  // Gate readiness: power-supply green, backend green, frontend not red,
  // cloud/ai not red. Operator can override individual non-green lamps
  // with a checkbox in the Gate card (yellow → green-equivalent).
  const lampStateForGate = useCallback((key: string, current: LampState): LampState => {
    if (gateOverrides[key] && current === 'yellow') return 'green';
    return current;
  }, [gateOverrides]);

  const psFinal = lampStateForGate('power-supply', powerSupplyState);
  const beFinal = lampStateForGate('backend', backendState);
  const feFinal = lampStateForGate('frontend', frontendState);
  const aiFinal = lampStateForGate('cloud-ai', cloudAiState);

  const goodToOperate =
    psFinal === 'green' &&
    beFinal === 'green' &&
    feFinal !== 'red' &&
    aiFinal !== 'red';

  // Auto-POST /api/basic-check/pass once the tower flips to all-green.
  // Guarded by autoPassFor so a flapping lamp doesn't spam the endpoint.
  const [autoPassFor, setAutoPassFor] = useState<string | null>(null);
  useEffect(() => {
    if (!goodToOperate || !moduleId || autoPassFor === moduleId) return;
    const ctl = new AbortController();
    (async () => {
      try {
        const r = await fetch(`${BACKEND}/api/basic-check/pass`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ module_id: moduleId }), signal: ctl.signal,
        });
        if (r.ok) setAutoPassFor(moduleId);
      } catch { /* non-blocking — gate re-fires on next poll */ }
    })();
    return () => ctl.abort();
  }, [goodToOperate, moduleId, autoPassFor]);

  // ---- manual-set + output actions ----

  const sendScpi = useCallback(async (cmd: string): Promise<QueryResult | null> => {
    const url = `${BACKEND}/api/scpi/query?cmd=${encodeURIComponent(cmd)}`;
    const r = await fetchJson<QueryResult>(url, 5000);
    return r.data ?? null;
  }, []);

  const onApply = useCallback(async () => {
    setActionBusy(true);
    setActionErr(null);
    try {
      await sendScpi(`SOUR:VOLT ${vSet}`);
      await sendScpi(`SOUR:CURR ${iSet}`);
      await onReadback();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }, [vSet, iSet, sendScpi]);

  const onOutput = useCallback(async (state: 'on' | 'off') => {
    setActionBusy(true);
    setActionErr(null);
    try {
      const cmd = state === 'on' ? 'OUTP ON' : 'OUTP OFF';
      const r = await sendScpi(cmd);
      if (r?.error) {
        setActionErr(r.error);
      } else {
        setOutput(state);
      }
      await onReadback();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }, [sendScpi]);

  const onClearFault = useCallback(async () => {
    setActionBusy(true);
    setActionErr(null);
    try {
      await sendScpi('*CLS');
      await onReadback();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  }, [sendScpi]);

  const onReadback = useCallback(async () => {
    const [v, i, p, t] = await Promise.all([
      sendScpi('MEAS:VOLT?'),
      sendScpi('MEAS:CURR?'),
      sendScpi('MEAS:POW?'),
      sendScpi('MEAS:TEMP?'),
    ]);
    const fnum = (s?: string) => {
      if (!s) return undefined;
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
    };
    setReadback({
      v: fnum(v?.response),
      i: fnum(i?.response),
      p: fnum(p?.response),
      t: fnum(t?.response),
      mode: transport?.demo || idn?.demo ? 'DEMO' : 'LIVE',
      updated: new Date().toLocaleTimeString(),
    });
  }, [sendScpi, transport, idn]);

  return (
    <div className="space-y-4">
      {/* Status Tower */}
      <StatusTower
        lamps={[
          { key: 'power-supply', label: 'Power Supply', state: powerSupplyState, detail: powerSupplyDetail },
          { key: 'backend',      label: 'Backend',      state: backendState,     detail: backendDetail },
          { key: 'frontend',     label: 'Frontend',     state: frontendState,    detail: frontendDetail },
          { key: 'cloud-ai',     label: 'Cloud / AI',   state: cloudAiState,     detail: cloudAiDetail },
        ]}
      />

      {/* Quick legend / Help affordance */}
      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <span>
          <span className="text-emerald-400 font-semibold">green</span> = go ·{' '}
          <span className="text-amber-400 font-semibold">yellow</span> = resolve via{' '}
          <Link href="/help/troubleshooting" className="underline hover:text-amber-300">Help / Q&amp;A</Link> ·{' '}
          <span className="text-rose-400 font-semibold">red</span> = stop ·{' '}
          <span className="text-gray-400 font-semibold">gray</span> = unknown
        </span>
      </div>

      {/* Connection card */}
      <Card title="Connection">
        <KV label="API health"        value={`${health.status}${health.version ? ` · v${health.version}` : ''}`} />
        <KV label="Device registry"   value={registryErr ? `unreachable (${registryErr})` : `${registry?.count ?? 0} device(s)`} bad={Boolean(registryErr)} />
        <KV label="WebSocket"         value={wsStatus} warn={wsStatus === 'demo' || wsStatus === 'connecting'} bad={wsStatus === 'disconnected'} />
        <KV label="SCPI transport"    value={transport ? `${transport.kind} ${transport.host}:${transport.port}` : (transportErr ?? 'probing…')} bad={!!transportErr || (transport ? !transport.reachable && !transport.demo : false)} />
        <KV label="*IDN?"             value={idnErr ?? (idn?.error ?? idn?.idn ?? 'querying…')} bad={!!idnErr || !!idn?.error} warn={Boolean(idn && !idn.demo && /DEMO|SIM/i.test(idn.idn))} />
        <div className="pt-2">
          <Btn onClick={() => { void refreshSCPI(); void refreshRegistry(); }}>Re-probe</Btn>
        </div>
      </Card>

      {/* Manual Set + Output cards in one row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Manual Set">
          <NumInput label="Voltage Set"   value={vSet} setValue={setVSet} step={0.1} unit="V" />
          <NumInput label="Current Limit" value={iSet} setValue={setISet} step={0.1} unit="A" />
          <div className="flex gap-2 pt-1">
            <Btn onClick={onApply} disabled={actionBusy} variant="blue">Apply</Btn>
            <Btn onClick={onReadback} disabled={actionBusy}>Read Back</Btn>
          </div>
          {actionErr && <div className="text-xs text-rose-400 mt-1" data-testid="basic-check-action-error">{actionErr}</div>}
        </Card>

        <Card title="Output">
          <KV label="State" value={output.toUpperCase()} bad={output === 'unknown'} />
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn onClick={() => onOutput('on')}  disabled={actionBusy} variant="green">Output ON</Btn>
            <Btn onClick={() => onOutput('off')} disabled={actionBusy} variant="red">Output OFF</Btn>
            <Btn onClick={onClearFault}          disabled={actionBusy} variant="yellow">Clear Fault</Btn>
          </div>
        </Card>
      </div>

      {/* Measured card */}
      <Card title="Measured">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label="Voltage"     value={readback.v} unit="V" />
          <Metric label="Current"     value={readback.i} unit="A" />
          <Metric label="Power"       value={readback.p} unit="W" />
          <Metric label="Temperature" value={readback.t} unit="°C" />
        </div>
        <div className="flex gap-4 text-[11px] text-gray-500 pt-2">
          <span>Mode: <span className="text-gray-300">{readback.mode ?? '—'}</span></span>
          <span>Output: <span className="text-gray-300">{output.toUpperCase()}</span></span>
          <span>Last updated: <span className="text-gray-300">{readback.updated ?? '—'}</span></span>
        </div>
      </Card>

      {/* Gate card */}
      <Card title={goodToOperate ? 'Basic Check Passed' : 'Basic Check'} accent={goodToOperate ? 'emerald' : 'rose'}>
        <ul className="space-y-1.5 text-xs">
          <GateRow label="Power Supply ready (transport reachable + IDN valid)" state={psFinal}
            override={gateOverrides['power-supply']} canOverride={false} />
          <GateRow label="Backend ready (/api/health ok + device registry)" state={beFinal}
            override={gateOverrides['backend']} canOverride={false} />
          <GateRow label="Frontend not red (WebSocket reachable or demo)" state={feFinal}
            override={gateOverrides['frontend']}
            canOverride={frontendState === 'yellow'}
            onOverride={v => setGateOverrides(o => ({ ...o, frontend: v }))}
          />
          <GateRow label="Cloud / AI not red (AI endpoint reachable)" state={aiFinal}
            override={gateOverrides['cloud-ai']}
            canOverride={cloudAiState === 'yellow'}
            onOverride={v => setGateOverrides(o => ({ ...o, 'cloud-ai': v }))}
          />
        </ul>
        <div className="pt-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] text-gray-500">
            Operation gate is {goodToOperate ? <span className="text-emerald-400 font-semibold">CLEAR</span> : <span className="text-rose-400 font-semibold">BLOCKED</span>} — switch to Setup once green.
          </div>
          <div data-testid="basic-check-gate" data-gate={goodToOperate ? 'pass' : 'block'} />
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers — kept inline to keep the diff bounded.
// ---------------------------------------------------------------------------

function Card({ title, children, accent = 'gray' }: { title: string; children: React.ReactNode; accent?: 'gray' | 'emerald' | 'rose' }) {
  const ring = accent === 'emerald'
    ? 'ring-emerald-500/40'
    : accent === 'rose'
      ? 'ring-rose-500/40'
      : 'ring-gray-800';
  return (
    <section className={`bg-gray-900 border border-gray-800 rounded-lg p-4 ring-1 ${ring}`}>
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-300 mb-3">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function KV({ label, value, bad, warn }: { label: string; value: string; bad?: boolean; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono ${bad ? 'text-rose-400' : warn ? 'text-amber-400' : 'text-gray-200'} truncate text-right`} title={value}>
        {value}
      </span>
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value?: number; unit: string }) {
  return (
    <div className="bg-gray-950 rounded p-3 border border-gray-800">
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-white tabular-nums">
        {value === undefined ? '—' : value.toFixed(2)}{' '}
        <span className="text-xs font-normal text-gray-400">{unit}</span>
      </div>
    </div>
  );
}

function NumInput({ label, value, setValue, step, unit }: {
  label: string; value: number; setValue: (n: number) => void; step?: number; unit: string;
}) {
  return (
    <div>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      <div className="flex gap-2 items-center">
        <input
          type="number" value={value} step={step ?? 1}
          onChange={e => setValue(Number(e.target.value))}
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
        />
        <span className="text-xs text-gray-500 w-12">{unit}</span>
      </div>
    </div>
  );
}

function Btn({ children, onClick, disabled, variant = 'gray' }: {
  children: React.ReactNode;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  variant?: 'gray' | 'green' | 'yellow' | 'blue' | 'red';
}) {
  const cls = {
    gray:   'bg-gray-800 hover:bg-gray-700 text-gray-200',
    green:  'bg-emerald-700 hover:bg-emerald-600 text-white',
    yellow: 'bg-amber-700 hover:bg-amber-600 text-white',
    blue:   'bg-blue-700 hover:bg-blue-600 text-white',
    red:    'bg-rose-700 hover:bg-rose-600 text-white',
  }[variant];
  return (
    <button
      type="button"
      onClick={() => { void onClick(); }}
      disabled={disabled}
      className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >
      {children}
    </button>
  );
}

function GateRow({ label, state, override, canOverride, onOverride }: {
  label: string;
  state: LampState;
  override?: boolean;
  canOverride?: boolean;
  onOverride?: (v: boolean) => void;
}) {
  const icon = state === 'green' ? '✓' : state === 'yellow' ? '!' : state === 'red' ? '✗' : '·';
  const cls = state === 'green' ? 'text-emerald-400'
    : state === 'yellow' ? 'text-amber-400'
    : state === 'red' ? 'text-rose-400'
    : 'text-gray-500';
  return (
    <li className="flex items-center gap-2">
      <span className={`font-mono text-sm w-4 text-center ${cls}`}>{icon}</span>
      <span className="text-gray-200 flex-1">{label}</span>
      {canOverride && onOverride && (
        <label className="text-[10px] text-gray-400 inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!override}
            onChange={e => onOverride(e.target.checked)}
            className="accent-amber-500"
          />
          override
        </label>
      )}
    </li>
  );
}
