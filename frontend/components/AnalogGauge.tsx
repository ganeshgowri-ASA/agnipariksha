'use client'

interface Props {
  label: string
  value: number
  min: number
  max: number
  unit: string
}

export default function AnalogGauge({ label, value, min, max, unit }: Props) {
  const pct = Math.min(Math.max((value - min) / (max - min), 0), 1)
  const angle = -135 + pct * 270  // -135° to +135°
  const radius = 40
  const cx = 50, cy = 55

  // Arc path
  const polarToXY = (angleDeg: number, r: number) => ({
    x: cx + r * Math.cos((angleDeg - 90) * Math.PI / 180),
    y: cy + r * Math.sin((angleDeg - 90) * Math.PI / 180),
  })

  const start = polarToXY(-135, radius)
  const end   = polarToXY(135, radius)
  const needle = polarToXY(angle, radius - 5)

  return (
    <div className="flex flex-col items-center mb-3">
      <span className="text-xs text-gray-400 mb-1">{label}</span>
      <svg width="100" height="80" viewBox="0 0 100 80">
        {/* Background arc */}
        <path
          d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 1 1 ${end.x} ${end.y}`}
          fill="none" stroke="#374151" strokeWidth="6" strokeLinecap="round"
        />
        {/* Value arc */}
        <path
          d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 ${pct > 0.5 ? 1 : 0} 1 ${polarToXY(angle, radius).x} ${polarToXY(angle, radius).y}`}
          fill="none" stroke="#10b981" strokeWidth="6" strokeLinecap="round"
        />
        {/* Needle */}
        <line
          x1={cx} y1={cy}
          x2={needle.x} y2={needle.y}
          stroke="#f59e0b" strokeWidth="2" strokeLinecap="round"
        />
        {/* Center dot */}
        <circle cx={cx} cy={cy} r="3" fill="#f59e0b" />
        {/* Value text */}
        <text x={cx} y={cy + 18} textAnchor="middle" fill="#10b981" fontSize="11" fontFamily="monospace" fontWeight="bold">
          {value.toFixed(2)}{unit}
        </text>
      </svg>
    </div>
  )
}
