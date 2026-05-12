'use client';

import { useMemo } from 'react';

export interface HFProfilePoint {
  t_s: number;
  cycle: number;
  phase: string;
  T: number;
  RH: number;
  I: number;
}

interface Props {
  profile: HFProfilePoint[];
  width?: number;
  height?: number;
  /** show RH overlay */
  showRh?: boolean;
}

/**
 * Figure 9 (IEC 61215-2 Fig 9) renderer with RH overlay.
 *
 * Temperature is plotted on the primary (left) axis in °C and RH on the
 * secondary (right) axis in %. Cycle boundaries are highlighted with
 * faint vertical grid lines so operators can spot drift between cycles.
 */
export default function HumidityFreezeProfileChart({
  profile, width = 720, height = 260, showRh = true,
}: Props) {
  const layout = useMemo(() => {
    if (profile.length === 0) return null;
    const padL = 48, padR = showRh ? 48 : 12, padT = 24, padB = 30;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const tMin = profile[0].t_s;
    const tMax = profile[profile.length - 1].t_s || tMin + 1;
    const tempMin = -50, tempMax = 100;          // IEC envelope
    const rhMin = 0, rhMax = 100;
    const sx = (t: number) => padL + ((t - tMin) / (tMax - tMin)) * plotW;
    const syT = (v: number) =>
      padT + plotH - ((v - tempMin) / (tempMax - tempMin)) * plotH;
    const syR = (v: number) =>
      padT + plotH - ((v - rhMin) / (rhMax - rhMin)) * plotH;
    const tempPath = profile
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.t_s).toFixed(1)} ${syT(p.T).toFixed(1)}`)
      .join(' ');
    const rhPath = profile
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.t_s).toFixed(1)} ${syR(p.RH).toFixed(1)}`)
      .join(' ');
    const cycleBoundaries: number[] = [];
    let lastCycle = -1;
    for (const p of profile) {
      if (p.cycle !== lastCycle) {
        cycleBoundaries.push(p.t_s);
        lastCycle = p.cycle;
      }
    }
    return { padL, padR, padT, padB, plotW, plotH, tempPath, rhPath,
             cycleBoundaries, sx, syT, syR, tMin, tMax };
  }, [profile, width, height, showRh]);

  if (!layout) {
    return (
      <div className="h-[260px] flex items-center justify-center text-xs text-gray-500 bg-gray-900 rounded border border-gray-700">
        No profile loaded yet — press Start to fetch the Figure 9 envelope.
      </div>
    );
  }

  const yTicksTemp = [-40, -20, 0, 25, 50, 85];
  const yTicksRh = [0, 25, 50, 75, 100];

  return (
    <svg
      data-testid="hf-profile-chart"
      width={width} height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="bg-gray-900 rounded border border-gray-700"
    >
      <text x={layout.padL} y={14} fontSize={11} fill="#e5e7eb" fontWeight="bold">
        IEC 61215-2 Figure 9 — Humidity Freeze profile
      </text>
      {/* Cycle boundary verticals */}
      {layout.cycleBoundaries.map((t, i) => (
        <line key={i} x1={layout.sx(t)} y1={layout.padT}
              x2={layout.sx(t)} y2={layout.padT + layout.plotH}
              stroke="#1f2937" strokeDasharray="2 3" />
      ))}
      {/* Y-axis ticks (T °C) */}
      {yTicksTemp.map(v => (
        <g key={v}>
          <line x1={layout.padL} y1={layout.syT(v)}
                x2={layout.padL + layout.plotW} y2={layout.syT(v)}
                stroke="#1f2937" strokeWidth={0.5} />
          <text x={layout.padL - 4} y={layout.syT(v) + 3}
                fontSize={9} fill="#9ca3af" textAnchor="end">{v}</text>
        </g>
      ))}
      {/* Y-axis ticks (RH %) on right */}
      {showRh && yTicksRh.map(v => (
        <text key={v}
              x={width - layout.padR + 4} y={layout.syR(v) + 3}
              fontSize={9} fill="#06b6d4" textAnchor="start">{v}%</text>
      ))}
      {/* Axes */}
      <line x1={layout.padL} y1={layout.padT}
            x2={layout.padL} y2={layout.padT + layout.plotH}
            stroke="#374151" />
      <line x1={layout.padL} y1={layout.padT + layout.plotH}
            x2={layout.padL + layout.plotW} y2={layout.padT + layout.plotH}
            stroke="#374151" />
      {/* RH overlay */}
      {showRh && (
        <path d={layout.rhPath} fill="none" stroke="#06b6d4" strokeWidth={1.2} opacity={0.7} />
      )}
      {/* Temperature */}
      <path d={layout.tempPath} fill="none" stroke="#f59e0b" strokeWidth={1.6} />
      {/* X-axis label */}
      <text x={layout.padL + layout.plotW / 2} y={height - 6}
            fontSize={10} fill="#9ca3af" textAnchor="middle">
        Elapsed time (s, compressed) — {layout.cycleBoundaries.length} cycle{layout.cycleBoundaries.length === 1 ? '' : 's'}
      </text>
      {/* Axis labels */}
      <text x={10} y={layout.padT - 6} fontSize={10} fill="#f59e0b">T (°C)</text>
      {showRh && (
        <text x={width - layout.padR + 4} y={layout.padT - 6}
              fontSize={10} fill="#06b6d4">RH (%)</text>
      )}
    </svg>
  );
}
