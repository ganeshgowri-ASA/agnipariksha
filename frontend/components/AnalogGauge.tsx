'use client';

interface AnalogGaugeProps {
  label: string;
  value: number;
  max: number;
  unit: string;
  color: string;
  warningThreshold?: number;
  dangerThreshold?: number;
}

export default function AnalogGauge({ label, value, max, unit, color, warningThreshold, dangerThreshold }: AnalogGaugeProps) {
  const pct = Math.min(1, Math.max(0, value / max));
  const angle = -135 + pct * 270; // -135 to +135 degrees
  const r = 40;
  const cx = 60; const cy = 65;

  // Arc path helper
  const polarToCartesian = (angle: number) => ({
    x: cx + r * Math.cos((angle * Math.PI) / 180),
    y: cy + r * Math.sin((angle * Math.PI) / 180),
  });

  const startAngle = -135 + 90; // SVG coords (90° offset)
  const endAngle = startAngle + pct * 270;
  const start = polarToCartesian(startAngle);
  const end = polarToCartesian(endAngle);
  const largeArc = pct * 270 > 180 ? 1 : 0;

  const bgStart = polarToCartesian(startAngle);
  const bgEnd = polarToCartesian(startAngle + 270);

  const isWarning = warningThreshold && value >= warningThreshold;
  const isDanger = dangerThreshold && value >= dangerThreshold;
  const activeColor = isDanger ? '#ef4444' : isWarning ? '#f59e0b' : color;

  // Needle
  const needleAngle = -135 + 90 + pct * 270;
  const needleTip = polarToCartesian(needleAngle);
  const needleBase1 = polarToCartesian(needleAngle + 90);
  const needleBase2 = polarToCartesian(needleAngle - 90);

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-3 flex flex-col items-center">
      <svg width="120" height="90" viewBox="0 0 120 90">
        {/* Background arc */}
        <path
          d={`M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 1 1 ${bgEnd.x} ${bgEnd.y}`}
          fill="none" stroke="#374151" strokeWidth="6" strokeLinecap="round"
        />
        {/* Value arc */}
        {pct > 0 && (
          <path
            d={`M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`}
            fill="none" stroke={activeColor} strokeWidth="6" strokeLinecap="round"
          />
        )}
        {/* Needle */}
        <line
          x1={cx} y1={cy}
          x2={+(cx + (r - 8) * Math.cos((needleAngle * Math.PI) / 180)).toFixed(1)}
          y2={+(cy + (r - 8) * Math.sin((needleAngle * Math.PI) / 180)).toFixed(1)}
          stroke="#e5e7eb" strokeWidth="2" strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r="4" fill="#6b7280" />
        {/* Value text */}
        <text x={cx} y={cy + 18} textAnchor="middle" fontSize="11" fontFamily="monospace"
          fill={activeColor} fontWeight="bold">
          {value.toFixed(2)}
        </text>
        <text x={cx} y={cy + 27} textAnchor="middle" fontSize="7" fill="#6b7280">{unit}</text>
      </svg>
      <p className="text-xs text-gray-400 mt-1 font-medium">{label}</p>
    </div>
  );
}
