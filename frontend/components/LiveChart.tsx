'use client';

import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { LiveReading } from '@/app/page';

interface LiveChartProps {
  readings: LiveReading[];
  metric: keyof LiveReading;
  color: string;
  label: string;
  referenceLines?: Array<{ value: number; label: string; color?: string }>;
  yDomain?: [number, number];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs">
      <p className="text-gray-400">{new Date(label).toLocaleTimeString()}</p>
      <p style={{ color: payload[0].color }} className="font-mono font-bold">
        {payload[0].value?.toFixed(4)}
      </p>
    </div>
  );
};

export default function LiveChart({ readings, metric, color, label, referenceLines = [], yDomain }: LiveChartProps) {
  const data = useMemo(() => readings.slice(-120).map(r => ({
    timestamp: r.timestamp,
    value: r[metric] as number,
  })), [readings, metric]);

  const values = data.map(d => d.value).filter(v => v !== undefined && !isNaN(v));
  const minVal = values.length ? Math.min(...values) : 0;
  const maxVal = values.length ? Math.max(...values) : 1;
  const padding = (maxVal - minVal) * 0.1 || 0.5;
  const domain = yDomain || [+(minVal - padding).toFixed(3), +(maxVal + padding).toFixed(3)];

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-300">{label}</span>
        <span className="text-xs font-mono" style={{ color }}>
          {values[values.length - 1]?.toFixed(4) ?? '—'}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={v => new Date(v).toLocaleTimeString()}
            tick={{ fontSize: 9, fill: '#6b7280' }}
            interval="preserveStartEnd"
          />
          <YAxis domain={domain} tick={{ fontSize: 9, fill: '#6b7280' }} width={45}
            tickFormatter={v => v.toFixed(2)} />
          <Tooltip content={<CustomTooltip />} />
          {referenceLines.map(rl => (
            <ReferenceLine key={rl.label} y={rl.value} stroke={rl.color || '#ef4444'}
              strokeDasharray="4 4" label={{ value: rl.label, fontSize: 9, fill: rl.color || '#ef4444' }} />
          ))}
          <Line
            type="monotone" dataKey="value" stroke={color} strokeWidth={1.5}
            dot={false} isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
