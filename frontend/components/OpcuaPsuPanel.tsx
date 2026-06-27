'use client';
import { useState } from 'react';
import { useOpcuaPsu } from '@/hooks/useOpcuaPsu';
import {
  type PsuSetpoints,
  isNodeWritable,
  validateSetpoint,
} from '@/features/opcua/psuClient';

const STATUS_STYLE: Record<string, string> = {
  connected: 'bg-green-500/20 text-green-400',
  error: 'bg-red-500/20 text-red-400',
  idle: 'bg-zinc-500/20 text-zinc-400',
};

function Tile({ label, value, unit }: { label: string; value: number | undefined; unit: string }) {
  return (
    <div className="rounded-lg bg-zinc-800/60 p-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="mt-1 font-mono text-lg text-zinc-100">
        {value === undefined || Number.isNaN(value) ? '—' : value.toFixed(3)}
        <span className="ml-1 text-xs text-zinc-500">{unit}</span>
      </div>
    </div>
  );
}

/**
 * In-app OPC UA PSU dashboard. Mirrors the DC power supply over the backend
 * OPC UA REST proxy: live readings tiles + a guarded setpoint form. Only the
 * server's writable Setpoint nodes are editable.
 */
export default function OpcuaPsuPanel() {
  const { state, status, writeSetpoints } = useOpcuaPsu({ pollMs: 1000 });
  const [voltage, setVoltage] = useState('0');
  const [current, setCurrent] = useState('0');
  const [output, setOutput] = useState(false);

  const candidate: PsuSetpoints = {
    voltage_v: Number(voltage),
    current_a: Number(current),
    output_enabled: output,
  };
  const errors = validateSetpoint(candidate);
  const writable = state?.writable_nodes ?? [];
  const canEdit = isNodeWritable('Voltage_Setpoint_V', writable) || status !== 'connected';

  return (
    <div className="space-y-4 rounded-xl border border-zinc-700 bg-zinc-900 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-yellow-400">
            DC Power Supply — OPC UA mirror
          </h3>
          <p className="text-xs text-zinc-500">
            {state?.model ?? 'PSU'} · mode {state?.mode ?? '—'}
          </p>
        </div>
        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`}>
          {status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Voltage" value={state?.voltage_v} unit="V" />
        <Tile label="Current" value={state?.current_a} unit="A" />
        <Tile label="Power" value={state?.power_w} unit="W" />
        <Tile label="Tj" value={state?.temperature_c} unit="°C" />
      </div>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (errors.length === 0) void writeSetpoints(candidate);
        }}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label className="text-xs text-zinc-400">
            Voltage setpoint (V)
            <input
              type="number" step="0.1" value={voltage}
              onChange={(e) => setVoltage(e.target.value)}
              className="mt-1 w-full rounded bg-zinc-800 px-2 py-1 font-mono text-zinc-100"
            />
          </label>
          <label className="text-xs text-zinc-400">
            Current setpoint (A)
            <input
              type="number" step="0.1" value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="mt-1 w-full rounded bg-zinc-800 px-2 py-1 font-mono text-zinc-100"
            />
          </label>
          <label className="flex items-end gap-2 text-xs text-zinc-400">
            <input type="checkbox" checked={output} onChange={(e) => setOutput(e.target.checked)} />
            Output enabled
          </label>
        </div>

        {errors.length > 0 && (
          <ul className="text-[11px] text-red-400">
            {errors.map((msg) => <li key={msg}>{msg}</li>)}
          </ul>
        )}

        <button
          type="submit"
          disabled={errors.length > 0 || !canEdit}
          className="rounded bg-yellow-500 px-3 py-1 text-sm font-semibold text-zinc-900 disabled:opacity-40"
        >
          Write setpoints
        </button>
      </form>
    </div>
  );
}
