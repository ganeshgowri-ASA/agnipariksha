'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

interface GaugeChartProps {
  id: string;
  nrOfLevels?: number;
  arcsLength?: number[];
  colors?: string[];
  percent: number;
  arcPadding?: number;
  textColor?: string;
  needleColor?: string;
  needleBaseColor?: string;
  hideText?: boolean;
  animate?: boolean;
  formatTextValue?: (value: string) => string;
}

// react-gauge-chart is a pure-client lib. Dynamic-import with ssr:false so it
// stays out of the server bundle and never touches `window` at build time.
const GaugeChart = dynamic(
  () => import('react-gauge-chart').then((m) => m.default as ComponentType<GaugeChartProps>),
  { ssr: false, loading: () => <div className="h-[110px]" /> },
);

interface AnalogGaugeProps {
  id: string;
  label: string;
  value: number;
  max: number;
  unit: string;
  warningThreshold?: number;
  dangerThreshold?: number;
}

export default function AnalogGauge({
  id,
  label,
  value,
  max,
  unit,
  warningThreshold,
  dangerThreshold,
}: AnalogGaugeProps) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.min(1, Math.max(0, value / safeMax));

  const warn = warningThreshold !== undefined ? warningThreshold / safeMax : 0.7;
  const danger = dangerThreshold !== undefined ? dangerThreshold / safeMax : 0.9;
  const safe = Math.max(0.01, warn);
  const warnSeg = Math.max(0.01, danger - warn);
  const dangerSeg = Math.max(0.01, 1 - danger);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-3 flex flex-col items-center">
      <div className="w-full max-w-[160px]">
        <GaugeChart
          id={id}
          nrOfLevels={20}
          arcsLength={[safe, warnSeg, dangerSeg]}
          colors={['#10b981', '#f59e0b', '#ef4444']}
          percent={pct}
          arcPadding={0.02}
          textColor="#e5e7eb"
          needleColor="#9ca3af"
          needleBaseColor="#4b5563"
          hideText
          animate={false}
        />
      </div>
      <p className="text-xs text-gray-400 -mt-1 font-medium">{label}</p>
      <p className="text-sm font-mono font-bold text-white">
        {value.toFixed(2)} <span className="text-xs font-normal text-gray-400">{unit}</span>
      </p>
    </div>
  );
}
