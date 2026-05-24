'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  type ElFrame,
  type ElRecipe,
  listFrames,
  listRecipes,
  saveFrame,
  saveRecipe,
  synthFrame,
} from '@/lib/el/elStore';

const CAMERAS = ['Hamamatsu C9300', 'PCO Edge 5.5'];
const SECTIONS = [
  { key: 'setup', label: 'Setup' },
  { key: 'monitor', label: 'Live Monitor' },
  { key: 'data', label: 'Data Table' },
  { key: 'analysis', label: 'Analysis' },
  { key: 'report', label: 'Report' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

const input =
  'mt-1 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200';
const card = 'bg-gray-900 rounded-lg border border-gray-700 p-4 space-y-3';

function Histogram({ bins }: { bins: number[] }) {
  const max = Math.max(1, ...bins);
  return (
    <div data-testid="el-histogram" className="flex items-end gap-px h-16 bg-gray-950 rounded p-1">
      {bins.map((b, i) => (
        <div
          key={i}
          className="flex-1 bg-indigo-400/70"
          style={{ height: `${(b / max) * 100}%` }}
          title={`bin ${i}: ${b}`}
        />
      ))}
    </div>
  );
}

export default function ElWorkspacePage() {
  const [section, setSection] = useState<SectionKey>('setup');
  const [camera, setCamera] = useState(CAMERAS[0]);
  const [setpointA, setSetpointA] = useState(9.5);
  const [exposureMs, setExposureMs] = useState(1000);
  const [gain, setGain] = useState(1.0);
  const [recipeName, setRecipeName] = useState('Default EL');
  const [recipes, setRecipes] = useState<ElRecipe[]>([]);
  const [frames, setFrames] = useState<ElFrame[]>([]);
  const [reference, setReference] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listFrames()
      .then((f) => setFrames(f.sort((a, b) => b.ts - a.ts)))
      .catch(() => {});
    listRecipes()
      .then(setRecipes)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const latest = frames[0] ?? null;

  const capture = async () => {
    const { dataUrl, histogram } = synthFrame(setpointA, gain);
    await saveFrame({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ts: Date.now(),
      camera,
      setpointA,
      exposureMs,
      gain,
      recipe: recipeName,
      dataUrl,
      histogram,
    });
    setSection('monitor');
    refresh();
  };

  const storeRecipe = async () => {
    if (!recipeName.trim()) return;
    await saveRecipe({ name: recipeName.trim(), camera, setpointA, exposureMs, gain });
    refresh();
  };

  const loadRecipe = (name: string) => {
    const r = recipes.find((x) => x.name === name);
    if (!r) return;
    setCamera(r.camera);
    setSetpointA(r.setpointA);
    setExposureMs(r.exposureMs);
    setGain(r.gain);
    setRecipeName(r.name);
  };

  const onDropReference = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setReference(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <main className="min-h-screen bg-gray-950 text-gray-200 p-6" data-testid="el-workspace">
      <header className="mb-4">
        <h1 className="text-lg font-bold text-indigo-300">Electroluminescence Workspace</h1>
        <p className="text-xs text-gray-400">
          IEC TS 60904-13 — forward-bias EL imaging.{' '}
          <span className="text-amber-400">DEMO mode — synthetic frames, no camera SDK.</span>
        </p>
      </header>

      <nav className="flex gap-1 mb-4 border-b border-gray-700">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            data-testid={`el-section-${s.key}`}
            onClick={() => setSection(s.key)}
            className={`px-3 py-1.5 text-xs rounded-t ${
              section === s.key
                ? 'bg-gray-900 text-indigo-300 border border-gray-700 border-b-0'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {section === 'setup' && (
        <div data-testid="el-pane-setup" className={card}>
          <h2 className="text-sm font-bold text-indigo-300">Acquisition Setup</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-400">
              Camera
              <select
                data-testid="el-camera"
                value={camera}
                onChange={(e) => setCamera(e.target.value)}
                className={input}
              >
                {CAMERAS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-400">
              Set point (A) — typical Isc … 0.1×Isc
              <input
                data-testid="el-setpoint"
                type="number"
                step={0.1}
                value={setpointA}
                onChange={(e) => setSetpointA(Number(e.target.value))}
                className={input}
              />
            </label>
            <label className="text-xs text-gray-400">
              Exposure (ms)
              <input
                data-testid="el-exposure"
                type="number"
                step={50}
                value={exposureMs}
                onChange={(e) => setExposureMs(Number(e.target.value))}
                className={input}
              />
            </label>
            <label className="text-xs text-gray-400">
              Gain
              <input
                data-testid="el-gain"
                type="number"
                step={0.1}
                value={gain}
                onChange={(e) => setGain(Number(e.target.value))}
                className={input}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-800">
            <label className="text-xs text-gray-400">
              Recipe name
              <input
                data-testid="el-recipe-name"
                type="text"
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                className={input}
              />
            </label>
            <label className="text-xs text-gray-400">
              Load preset
              <select
                data-testid="el-recipe-load"
                value=""
                onChange={(e) => loadRecipe(e.target.value)}
                className={input}
              >
                <option value="">— select —</option>
                {recipes.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              data-testid="el-save-recipe"
              onClick={storeRecipe}
              className="bg-gray-800 border border-gray-600 text-gray-200 text-xs rounded px-3 py-2 hover:bg-gray-700"
            >
              Save recipe
            </button>
            <button
              type="button"
              data-testid="el-capture"
              onClick={capture}
              className="flex-1 bg-indigo-700 hover:bg-indigo-600 text-white text-xs rounded px-3 py-2"
            >
              Capture EL frame (DEMO)
            </button>
          </div>
        </div>
      )}

      {section === 'monitor' && (
        <div data-testid="el-pane-monitor" className={card}>
          <h2 className="text-sm font-bold text-indigo-300">Live Monitor — last captured frame</h2>
          {latest ? (
            <>
              <img
                data-testid="el-frame-image"
                src={latest.dataUrl}
                alt="latest EL frame"
                className="w-full max-w-md border border-gray-700 rounded"
                style={{ imageRendering: 'pixelated' }}
              />
              <p className="text-xs text-gray-500">
                {camera} · {latest.setpointA.toFixed(1)} A · {latest.exposureMs} ms · gain{' '}
                {latest.gain.toFixed(1)} · {new Date(latest.ts).toLocaleString()}
              </p>
              <Histogram bins={latest.histogram} />
            </>
          ) : (
            <p className="text-xs text-gray-500">No frames captured yet. Capture one from Setup.</p>
          )}
        </div>
      )}

      {section === 'data' && (
        <div data-testid="el-pane-data" className={card}>
          <h2 className="text-sm font-bold text-indigo-300">Captured Frames</h2>
          <table className="w-full text-xs">
            <thead className="text-gray-500 border-b border-gray-700">
              <tr className="text-left">
                <th className="py-1">Timestamp</th>
                <th>Camera</th>
                <th>Set pt (A)</th>
                <th>Exp (ms)</th>
                <th>Gain</th>
                <th>Recipe</th>
              </tr>
            </thead>
            <tbody>
              {frames.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 text-gray-500">
                    No frames captured.
                  </td>
                </tr>
              ) : (
                frames.map((f) => (
                  <tr key={f.id} className="border-b border-gray-800 text-gray-300">
                    <td className="py-1">{new Date(f.ts).toLocaleString()}</td>
                    <td>{f.camera}</td>
                    <td>{f.setpointA.toFixed(1)}</td>
                    <td>{f.exposureMs}</td>
                    <td>{f.gain.toFixed(1)}</td>
                    <td>{f.recipe}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {section === 'analysis' && (
        <div data-testid="el-pane-analysis" className={card}>
          <h2 className="text-sm font-bold text-indigo-300">Reference Comparison</h2>
          <div className="grid grid-cols-2 gap-3">
            <div
              data-testid="el-dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDropReference}
              className="border-2 border-dashed border-gray-600 rounded flex items-center justify-center min-h-[160px] text-center text-xs text-gray-500 p-2"
            >
              {reference ? (
                <img
                  src={reference}
                  alt="reference frame"
                  className="max-h-40 border border-gray-700 rounded"
                  style={{ imageRendering: 'pixelated' }}
                />
              ) : (
                <span>Drag &amp; drop a reference frame image here</span>
              )}
            </div>
            <div className="flex items-center justify-center min-h-[160px]">
              {latest ? (
                <img
                  src={latest.dataUrl}
                  alt="latest captured frame"
                  className="max-h-40 border border-gray-700 rounded"
                  style={{ imageRendering: 'pixelated' }}
                />
              ) : (
                <span className="text-xs text-gray-500">No captured frame to compare.</span>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Left: reference (dropped) · Right: latest capture. Defect scoring is a DEMO placeholder.
          </p>
        </div>
      )}

      {section === 'report' && (
        <div data-testid="el-pane-report" className={card}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-indigo-300">EL Report (DEMO)</h2>
            <span
              data-testid="el-verdict"
              className="text-xs font-bold rounded-full px-3 py-1 bg-green-900/40 text-green-300 border border-green-700/50"
            >
              PASS (DEMO)
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {frames.slice(0, 4).map((f) => (
              <img
                key={f.id}
                src={f.dataUrl}
                alt="report frame"
                className="w-full border border-gray-700 rounded"
                style={{ imageRendering: 'pixelated' }}
              />
            ))}
            {frames.length === 0 && (
              <p className="col-span-4 text-xs text-gray-500">
                Capture frames to populate the report.
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
