'use client';

// Generic radio-style mode toggle. Kept standalone so later BDT Setup
// work (Basic Check tower, Nameplate panel, Schematic viewer) can layer
// additional modes/panels on top without touching the form internals.

export interface ModeOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface ModeToggleProps<T extends string> {
  name: string;
  legend?: string;
  value: T;
  options: ReadonlyArray<ModeOption<T>>;
  onChange: (value: T) => void;
}

export default function ModeToggle<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
}: ModeToggleProps<T>) {
  return (
    <fieldset
      className="bg-gray-900 rounded-lg border border-gray-700 p-4"
      data-testid={`mode-toggle-${name}`}
    >
      {legend && (
        <legend className="text-xs font-bold text-gray-300 px-1">{legend}</legend>
      )}
      <div className="space-y-2 mt-1">
        {options.map(opt => {
          const active = opt.value === value;
          return (
            <label
              key={opt.value}
              className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                active
                  ? 'border-orange-400 bg-gray-800/60'
                  : 'border-gray-700 hover:border-gray-500'
              }`}
              data-testid={`mode-option-${opt.value}`}
              data-state={active ? 'active' : 'inactive'}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={active}
                onChange={() => onChange(opt.value)}
                className="mt-0.5 accent-orange-400"
              />
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-gray-100">{opt.label}</span>
                {opt.description && (
                  <span className="block text-[11px] text-gray-400 mt-0.5">{opt.description}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
