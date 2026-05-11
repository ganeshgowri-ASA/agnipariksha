'use client';

import type { ModuleSpec, TestSchema } from '@/lib/testSchemas';

interface SetupFormProps {
  schema: TestSchema;
  module: ModuleSpec;
  onModuleChange: (next: ModuleSpec) => void;
  params: Record<string, number>;
  onParamsChange: (next: Record<string, number>) => void;
  running: boolean;
  onStart: () => void;
  onStop: () => void;
}

interface ModuleField {
  key: keyof ModuleSpec;
  label: string;
  unit: string;
  step?: number;
  text?: boolean;
}

const MODULE_FIELDS: ReadonlyArray<ModuleField> = [
  { key: 'sampleId', label: 'Sample ID', unit: '', text: true },
  { key: 'voc', label: 'Voc', unit: 'V', step: 0.1 },
  { key: 'isc', label: 'Isc', unit: 'A', step: 0.1 },
  { key: 'vmp', label: 'Vmp', unit: 'V', step: 0.1 },
  { key: 'imp', label: 'Imp', unit: 'A', step: 0.1 },
  { key: 'pmax', label: 'Pmax', unit: 'W', step: 1 },
  { key: 'fuseRating', label: 'Fuse rating', unit: 'A', step: 0.5 },
];

export default function SetupForm({
  schema,
  module,
  onModuleChange,
  params,
  onParamsChange,
  running,
  onStart,
  onStop,
}: SetupFormProps) {
  const updateModule = <K extends keyof ModuleSpec>(key: K, value: ModuleSpec[K]) => {
    onModuleChange({ ...module, [key]: value });
  };

  const updateParam = (key: string, value: number) => {
    onParamsChange({ ...params, [key]: value });
  };

  const sampleIdValid = module.sampleId.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className={`text-sm font-bold ${schema.color}`}>
            {schema.standard} · {schema.clause}
          </h3>
          <span className="text-xs text-gray-500">{schema.testName}</span>
        </div>
        <p className="text-xs text-gray-400 mb-4">{schema.description}</p>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h4 className="text-xs font-bold text-gray-300 mb-3 uppercase tracking-wide">
          Module Specification
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {MODULE_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
              <div className="flex gap-2 items-center">
                {f.text ? (
                  <input
                    type="text"
                    value={module[f.key] as string}
                    onChange={(e) => updateModule(f.key, e.target.value as never)}
                    placeholder="MOD-2026-001"
                    className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
                  />
                ) : (
                  <input
                    type="number"
                    value={module[f.key] as number}
                    step={f.step}
                    onChange={(e) =>
                      updateModule(f.key, Number(e.target.value) as never)
                    }
                    className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
                  />
                )}
                {f.unit && (
                  <span className="text-xs text-gray-500 w-8">{f.unit}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <h4 className="text-xs font-bold text-gray-300 mb-3 uppercase tracking-wide">
          {schema.clause} Parameters
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {schema.params.map((f) => (
            <div key={f.key}>
              <label className="text-xs text-gray-400 block mb-1">{f.label}</label>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  value={params[f.key] ?? f.defaultValue}
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  onChange={(e) => updateParam(f.key, Number(e.target.value))}
                  className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200"
                />
                <span className="text-xs text-gray-500 w-12">{f.unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onStart}
          disabled={running || !sampleIdValid}
          className="flex-1 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-sm rounded font-medium transition-colors"
          title={!sampleIdValid ? 'Enter a Sample ID first' : 'Start test'}
        >
          ▶ Start Test
        </button>
        <button
          onClick={onStop}
          disabled={!running}
          className="flex-1 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-sm rounded font-medium transition-colors"
        >
          ■ Stop Test
        </button>
      </div>
      {!sampleIdValid && (
        <p className="text-xs text-yellow-400">
          Sample ID is required before starting.
        </p>
      )}
    </div>
  );
}
