'use client';

import { useMemo, useState } from 'react';
import { Settings, Activity, Table2, BarChart3, FileText } from 'lucide-react';
import type { TestSession, LiveReading } from '@/types/test-session';
import ReportGenerator from '@/components/ReportGenerator';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

const COLS = 64;
const ROWS = 32;
const CAMERAS = ['FLIR T540', 'Optris PI 450i'];

type SubTab = 'setup' | 'monitor' | 'data' | 'analysis' | 'report';
const SUB_TABS: Array<{ key: SubTab; label: string; icon: typeof Settings }> = [
  { key: 'setup',    label: 'Setup',        icon: Settings },
  { key: 'monitor',  label: 'Live Monitor', icon: Activity },
  { key: 'data',     label: 'Data Table',   icon: Table2 },
  { key: 'analysis', label: 'Analysis',     icon: BarChart3 },
  { key: 'report',   label: 'Report',       icon: FileText },
];

// Deterministic PRNG so DEMO thermograms are reproducible per setup.
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Jet-like colormap: t in [0,1] → CSS rgb().
function jet(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 1)));
  return `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
}

function genThermogram(seed: number, ambient: number, current: number): number[] {
  const rand = mulberry32(seed);
  const spots = Array.from({ length: 4 }, () => ({
    x: rand() * COLS,
    y: rand() * ROWS,
    amp: 5 + rand() * (8 + current),
    sigma: 2.5 + rand() * 4,
  }));
  const temps = new Array<number>(ROWS * COLS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let t = ambient + 6 + current * 0.4 + rand() * 1.5;
      for (const s of spots) {
        const d2 = (c - s.x) ** 2 + (r - s.y) ** 2;
        t += s.amp * Math.exp(-d2 / (2 * s.sigma * s.sigma));
      }
      temps[r * COLS + c] = t;
    }
  }
  return temps;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default function InvertedIRTab({ session, demoMode }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('setup');

  // Setup
  const [forwardCurrent, setForwardCurrent] = useState(4.5); // A (~Isc)
  const [soakTime, setSoakTime] = useState(60);              // s
  const [camera, setCamera] = useState(CAMERAS[0]);
  const [emissivity, setEmissivity] = useState(0.85);
  const [ambientC, setAmbientC] = useState(25);
  const [threshold, setThreshold] = useState(10);            // delta-T °C

  const seed = Math.round(forwardCurrent * 100 + soakTime + ambientC * 10 + CAMERAS.indexOf(camera) * 7);
  const temps = useMemo(
    () => genThermogram(seed, ambientC, forwardCurrent),
    [seed, ambientC, forwardCurrent],
  );

  const tMin = useMemo(() => Math.min(...temps), [temps]);
  const tMax = useMemo(() => Math.max(...temps), [temps]);
  const tMed = useMemo(() => median(temps), [temps]);

  // Hot-spot detection: cells whose delta-T over the module median exceeds threshold.
  const hotSpots = useMemo(() => {
    const out: Array<{ idx: number; col: number; row: number; temp: number; deltaT: number }> = [];
    for (let i = 0; i < temps.length; i++) {
      const deltaT = temps[i] - tMed;
      if (deltaT > threshold) {
        out.push({ idx: i, col: i % COLS, row: (i / COLS) | 0, temp: temps[i], deltaT });
      }
    }
    return out.sort((a, b) => b.deltaT - a.deltaT);
  }, [temps, tMed, threshold]);

  const maxDeltaT = temps.length ? tMax - tMed : 0;
  const verdict = maxDeltaT < threshold ? 'PASS' : 'REVIEW';

  const setupPane = (
    <div className="max-w-2xl space-y-4" data-testid="subtab-pane-setup">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-bold text-pink-400 mb-3">Inverted IR — Forward-bias Thermography</h3>
        <p className="text-xs text-gray-400 mb-4">
          Drive the module under forward bias (≈0.5·Isc to Isc), soak, then capture an
          IR thermogram. Cells hotter than the module median by more than the threshold
          are flagged as potential hot-spots.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Forward-bias current (A)" testid="iir-setup-current">
            <input type="number" value={forwardCurrent} min={0} max={20} step={0.1}
              onChange={e => setForwardCurrent(Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Soak time (s)" testid="iir-setup-soak">
            <input type="number" value={soakTime} min={1} max={3600} step={1}
              onChange={e => setSoakTime(Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="IR camera" testid="iir-setup-camera">
            <select value={camera} onChange={e => setCamera(e.target.value)} className={inputCls}>
              {CAMERAS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Emissivity" testid="iir-setup-emissivity">
            <input type="number" value={emissivity} min={0.1} max={1} step={0.01}
              onChange={e => setEmissivity(Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Ambient temp (°C)" testid="iir-setup-ambient">
            <input type="number" value={ambientC} min={-20} max={60} step={1}
              onChange={e => setAmbientC(Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Hot-spot ΔT threshold (°C)" testid="iir-setup-threshold">
            <input type="number" value={threshold} min={1} max={60} step={1}
              onChange={e => setThreshold(Number(e.target.value))} className={inputCls} />
          </Field>
        </div>
      </div>
    </div>
  );

  const monitorPane = (
    <div className="space-y-4" data-testid="subtab-pane-monitor">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-3">
          Thermogram — {COLS}×{ROWS} ({camera})
        </h3>
        <div
          className="grid gap-px w-full max-w-3xl"
          style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
          data-testid="iir-thermogram"
        >
          {temps.map((t, i) => (
            <div key={i} className="aspect-square" style={{ background: jet((t - tMin) / (tMax - tMin || 1)) }} />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span className="text-[10px] text-gray-400 font-mono">{tMin.toFixed(1)}°C</span>
          <div className="flex-1 h-3 rounded" style={{
            background: `linear-gradient(to right, ${jet(0)}, ${jet(0.25)}, ${jet(0.5)}, ${jet(0.75)}, ${jet(1)})`,
          }} data-testid="iir-legend" />
          <span className="text-[10px] text-gray-400 font-mono">{tMax.toFixed(1)}°C</span>
        </div>
      </div>
    </div>
  );

  const dataPane = (
    <div data-testid="subtab-pane-data">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-3">
          Flagged cells ({hotSpots.length})
        </h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 text-left">
              <th className="py-1">Row</th><th>Col</th><th>Temp (°C)</th><th>ΔT (°C)</th>
            </tr>
          </thead>
          <tbody className="font-mono text-gray-200">
            {hotSpots.slice(0, 30).map(h => (
              <tr key={h.idx} className="border-t border-gray-800">
                <td className="py-1">{h.row}</td><td>{h.col}</td>
                <td>{h.temp.toFixed(1)}</td>
                <td className="text-pink-400">+{h.deltaT.toFixed(1)}</td>
              </tr>
            ))}
            {hotSpots.length === 0 && (
              <tr><td colSpan={4} className="py-2 text-gray-500">No cells exceed ΔT {threshold}°C.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const analysisPane = (
    <div data-testid="subtab-pane-analysis">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-3">
        <h3 className="text-xs uppercase tracking-wider text-gray-400">Hot-spot detection</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Module median" value={`${tMed.toFixed(1)}°C`} />
          <Stat label="Max temp" value={`${tMax.toFixed(1)}°C`} />
          <Stat label="Max ΔT" value={`+${maxDeltaT.toFixed(1)}°C`} color="text-pink-400" />
          <Stat label="Threshold" value={`${threshold}°C`} />
        </div>
        <p className="text-xs text-gray-400">
          {hotSpots.length} cell(s) exceed the median by more than {threshold}°C.
          Verdict: <span className={verdict === 'PASS' ? 'text-green-400' : 'text-amber-400'}>{verdict}</span>.
        </p>
      </div>
    </div>
  );

  const reportPane = (
    <div data-testid="subtab-pane-report">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-pink-400">Inverted IR Report</h3>
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
            verdict === 'PASS' ? 'bg-green-900/40 text-green-400' : 'bg-amber-900/40 text-amber-400'
          }`} data-testid="iir-verdict">{verdict}</span>
        </div>
        <h4 className="text-xs uppercase tracking-wider text-gray-400">Top-3 hot-spots</h4>
        <div className="grid grid-cols-3 gap-3" data-testid="iir-topspots">
          {(hotSpots.length ? hotSpots.slice(0, 3) : []).map(h => (
            <div key={h.idx} className="bg-gray-950 border border-gray-800 rounded p-2">
              <div className="aspect-video rounded mb-2" style={{
                background: `radial-gradient(circle, ${jet(1)} 0%, ${jet(0.5)} 45%, ${jet(0.1)} 100%)`,
              }} />
              <p className="text-[10px] text-gray-500">R{h.row} · C{h.col}</p>
              <p className="text-sm font-mono text-pink-400">+{h.deltaT.toFixed(1)}°C</p>
            </div>
          ))}
          {hotSpots.length === 0 && (
            <p className="col-span-3 text-xs text-gray-500">No hot-spots detected above threshold.</p>
          )}
        </div>
      </div>
      <div className="mt-4">
        <ReportGenerator
          session={session}
          testName="Inverted IR"
          standard="Forward-bias IR thermography"
        />
      </div>
    </div>
  );

  const panes: Record<SubTab, React.ReactNode> = {
    setup: setupPane, monitor: monitorPane, data: dataPane, analysis: analysisPane, report: reportPane,
  };

  return (
    <div className="flex flex-col h-full bg-gray-950" data-testid="test-tab-iir">
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-2 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-bold text-pink-400">Inverted IR</span>
        <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded">Forward-bias IR thermography</span>
        {demoMode && <span className="text-[10px] text-yellow-400 bg-yellow-900/30 px-1.5 py-0.5 rounded">DEMO</span>}
      </div>

      <div className="flex border-b border-gray-800 bg-gray-900 overflow-x-auto" role="tablist" data-testid="subtab-list">
        {SUB_TABS.map(({ key, label, icon: Icon }) => {
          const active = subTab === key;
          return (
            <button
              key={key} type="button" role="tab" aria-selected={active}
              onClick={() => setSubTab(key)}
              data-testid={`subtab-${key}`}
              data-state={active ? 'active' : 'inactive'}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                active ? 'border-pink-400 text-white bg-gray-800/50' : 'border-transparent text-gray-500 hover:text-gray-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto p-4">{panes[subTab]}</div>
    </div>
  );
}

const inputCls = 'w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200';

function Field({ label, testid, children }: { label: string; testid: string; children: React.ReactNode }) {
  return (
    <div data-testid={testid}>
      <label className="text-xs text-gray-400 block mb-1">{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-gray-950 rounded p-3 border border-gray-800">
      <p className="text-[10px] uppercase text-gray-500">{label}</p>
      <p className={`text-lg font-mono font-bold ${color || 'text-white'}`}>{value}</p>
    </div>
  );
}
