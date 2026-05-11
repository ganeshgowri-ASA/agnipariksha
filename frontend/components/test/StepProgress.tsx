'use client';

interface StepProgressProps {
  currentStep: number;
  totalSteps: number;
  label?: string;
  accentHex: string;
  elapsedSec: number;
  remainingSec: number;
}

function formatDuration(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec < 0) return '—';
  const s = Math.round(totalSec);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

export default function StepProgress({
  currentStep,
  totalSteps,
  label,
  accentHex,
  elapsedSec,
  remainingSec,
}: StepProgressProps) {
  const safeTotal = totalSteps > 0 ? totalSteps : 1;
  const pct = Math.min(100, Math.max(0, (currentStep / safeTotal) * 100));

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400 font-medium">{label ?? 'Progress'}</span>
        <span className="font-mono text-gray-300">
          step {currentStep} / {totalSteps}
        </span>
      </div>
      <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: accentHex }}
        />
      </div>
      <div className="flex justify-between text-xs font-mono text-gray-400">
        <span>
          elapsed <span className="text-white">{formatDuration(elapsedSec)}</span>
        </span>
        <span>{pct.toFixed(1)} %</span>
        <span>
          remaining <span className="text-white">{formatDuration(remainingSec)}</span>
        </span>
      </div>
    </div>
  );
}
