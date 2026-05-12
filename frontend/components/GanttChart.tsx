'use client';

import { useMemo, useRef, useState } from 'react';

export type ScheduleSlot = {
  id: string;
  equipment_id: string;
  run_id: string;
  start: string;
  end: string;
  status: 'planned' | 'running' | 'completed' | 'cancelled';
};

type ViewMode = 'weekly' | 'monthly';

type DragState = {
  id: string;
  pointerStartX: number;
  originalStart: number;
  originalEnd: number;
  currentDeltaMs: number;
};

const STATUS_COLOR: Record<ScheduleSlot['status'], string> = {
  planned: '#3b82f6',
  running: '#22c55e',
  completed: '#6b7280',
  cancelled: '#ef4444',
};

const ROW_HEIGHT = 56;
const ROW_PADDING = 8;
const HEADER_HEIGHT = 48;
const LANE_LABEL_WIDTH = 140;
const MIN_BAR_WIDTH = 10;

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function viewRange(mode: ViewMode, anchor: Date): { start: Date; end: Date; days: number } {
  const a = startOfDayUtc(anchor);
  if (mode === 'weekly') {
    const dow = a.getUTCDay();
    const monday = new Date(a);
    monday.setUTCDate(a.getUTCDate() - ((dow + 6) % 7));
    const end = new Date(monday);
    end.setUTCDate(monday.getUTCDate() + 7);
    return { start: monday, end, days: 7 };
  }
  const first = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1));
  const last = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1));
  const days = Math.round((last.getTime() - first.getTime()) / 86400000);
  return { start: first, end: last, days };
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtRange(start: Date, end: Date): string {
  const endShown = new Date(end.getTime() - 1);
  return `${fmtDay(start)} – ${fmtDay(endShown)} ${endShown.getUTCFullYear()}`;
}

function pxPerMs(viewStart: Date, viewEnd: Date, width: number): number {
  return width / (viewEnd.getTime() - viewStart.getTime());
}

export interface GanttChartProps {
  slots: ScheduleSlot[];
  mode: ViewMode;
  anchor: Date;
  /** Returns true if accepted, false if conflict (server returns 409). */
  onReschedule: (id: string, newStart: Date, newEnd: Date) => Promise<boolean>;
  /** Width in pixels of the inner chart area (excluding lane labels). */
  chartWidth?: number;
}

export default function GanttChart({
  slots,
  mode,
  anchor,
  onReschedule,
  chartWidth = 920,
}: GanttChartProps) {
  const { start: viewStart, end: viewEnd, days } = useMemo(
    () => viewRange(mode, anchor),
    [mode, anchor],
  );

  const lanes = useMemo(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const s of slots) {
      if (!seen.has(s.equipment_id)) {
        seen.add(s.equipment_id);
        ordered.push(s.equipment_id);
      }
    }
    if (ordered.length === 0) ordered.push('rig-1');
    return ordered.sort();
  }, [slots]);

  const laneIndex = useMemo(() => {
    const m = new Map<string, number>();
    lanes.forEach((l, i) => m.set(l, i));
    return m;
  }, [lanes]);

  const ppm = pxPerMs(viewStart, viewEnd, chartWidth);
  const totalHeight = HEADER_HEIGHT + lanes.length * ROW_HEIGHT + 8;

  const [drag, setDrag] = useState<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  function bx(t: number): number {
    return LANE_LABEL_WIDTH + (t - viewStart.getTime()) * ppm;
  }

  function handlePointerDown(e: React.PointerEvent<SVGGElement>, slot: ScheduleSlot) {
    if (slot.status === 'completed' || slot.status === 'cancelled') return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({
      id: slot.id,
      pointerStartX: e.clientX,
      originalStart: new Date(slot.start).getTime(),
      originalEnd: new Date(slot.end).getTime(),
      currentDeltaMs: 0,
    });
  }

  function handlePointerMove(e: React.PointerEvent<SVGGElement>) {
    if (!drag) return;
    const dx = e.clientX - drag.pointerStartX;
    setDrag({ ...drag, currentDeltaMs: dx / ppm });
  }

  async function handlePointerUp(e: React.PointerEvent<SVGGElement>, slot: ScheduleSlot) {
    if (!drag || drag.id !== slot.id) return;
    const deltaMs = drag.currentDeltaMs;
    setDrag(null);
    if (Math.abs(deltaMs) < 60_000) return; // ignore tiny drags (<1 min)
    const newStart = new Date(drag.originalStart + deltaMs);
    const newEnd = new Date(drag.originalEnd + deltaMs);
    await onReschedule(slot.id, newStart, newEnd);
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  }

  // Day grid ticks
  const dayTicks = useMemo(() => {
    const out: { x: number; label: string }[] = [];
    for (let i = 0; i <= days; i++) {
      const d = new Date(viewStart);
      d.setUTCDate(viewStart.getUTCDate() + i);
      out.push({ x: bx(d.getTime()), label: fmtDay(d) });
    }
    return out;
  }, [viewStart, days, ppm]);

  return (
    <div className="overflow-x-auto" data-testid="gantt-root">
      <div className="text-xs text-gray-400 mb-2">{fmtRange(viewStart, viewEnd)}</div>
      <svg
        ref={svgRef}
        width={LANE_LABEL_WIDTH + chartWidth}
        height={totalHeight}
        role="img"
        aria-label={`Gantt chart, ${mode} view`}
        data-testid="gantt-svg"
        style={{ background: '#0b1220', borderRadius: 6 }}
      >
        {/* Header: day labels */}
        <g>
          <rect x={0} y={0} width={LANE_LABEL_WIDTH + chartWidth} height={HEADER_HEIGHT} fill="#111827" />
          {dayTicks.slice(0, -1).map((t, i) => (
            <g key={i}>
              <line x1={t.x} y1={0} x2={t.x} y2={totalHeight} stroke="#1f2937" strokeWidth={1} />
              <text x={t.x + 4} y={HEADER_HEIGHT - 10} fontSize={11} fill="#9ca3af">
                {t.label}
              </text>
            </g>
          ))}
          <line
            x1={LANE_LABEL_WIDTH + chartWidth}
            y1={0}
            x2={LANE_LABEL_WIDTH + chartWidth}
            y2={totalHeight}
            stroke="#1f2937"
          />
        </g>

        {/* Lane rows */}
        {lanes.map((lane, i) => {
          const y = HEADER_HEIGHT + i * ROW_HEIGHT;
          return (
            <g key={lane}>
              <rect
                x={0}
                y={y}
                width={LANE_LABEL_WIDTH + chartWidth}
                height={ROW_HEIGHT}
                fill={i % 2 ? '#0f172a' : '#0b1220'}
              />
              <text x={12} y={y + ROW_HEIGHT / 2 + 4} fontSize={12} fill="#e5e7eb">
                {lane}
              </text>
              <line
                x1={LANE_LABEL_WIDTH}
                y1={y + ROW_HEIGHT}
                x2={LANE_LABEL_WIDTH + chartWidth}
                y2={y + ROW_HEIGHT}
                stroke="#1f2937"
              />
            </g>
          );
        })}

        {/* Bars */}
        {slots.map(slot => {
          const lane = laneIndex.get(slot.equipment_id);
          if (lane === undefined) return null;
          const isDragging = drag?.id === slot.id;
          const offset = isDragging ? (drag?.currentDeltaMs ?? 0) : 0;
          const sMs = new Date(slot.start).getTime() + offset;
          const eMs = new Date(slot.end).getTime() + offset;
          if (eMs < viewStart.getTime() || sMs > viewEnd.getTime()) return null;
          const x = bx(Math.max(sMs, viewStart.getTime()));
          const w = Math.max(MIN_BAR_WIDTH, bx(Math.min(eMs, viewEnd.getTime())) - x);
          const y = HEADER_HEIGHT + (lane ?? 0) * ROW_HEIGHT + ROW_PADDING;
          const fill = STATUS_COLOR[slot.status];
          return (
            <g
              key={slot.id}
              data-testid={`gantt-bar-${slot.run_id}`}
              data-slot-id={slot.id}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => handlePointerDown(e, slot)}
              onPointerMove={handlePointerMove}
              onPointerUp={(e) => handlePointerUp(e, slot)}
              onPointerCancel={() => setDrag(null)}
            >
              <rect
                x={x}
                y={y}
                width={w}
                height={ROW_HEIGHT - ROW_PADDING * 2}
                rx={4}
                fill={fill}
                opacity={isDragging ? 0.7 : 0.9}
                stroke="#111827"
                strokeWidth={1}
              />
              <text
                x={x + 6}
                y={y + (ROW_HEIGHT - ROW_PADDING * 2) / 2 + 4}
                fontSize={11}
                fill="#0b1220"
                fontWeight={600}
                pointerEvents="none"
                clipPath={`inset(0 0 0 0)`}
              >
                {slot.run_id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
