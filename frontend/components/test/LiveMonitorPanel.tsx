'use client';

import type { LiveReading } from '@/app/page';
import type { DerivedStat, TestLimits, TestSchema } from '@/lib/testSchemas';
import LiveChart from '../LiveChart';
import AnalogGauge from './GaugePanel';
import StepProgress from './StepProgress';

interface LiveMonitorPanelProps {
  schema: TestSchema;
  readings: ReadonlyArray<LiveReading>;
  limits: TestLimits;
  derivedStats: DerivedStat[];
  currentStep: number;
  totalSteps: number;
  elapsedSec: number;
  remainingSec: number;
}

export default function LiveMonitorPanel({
  schema,
  readings,
  limits,
  derivedStats,
  currentStep,
  totalSteps,
  elapsedSec,
  remainingSec,
}: LiveMonitorPanelProps) {
  const latest = readings.length > 0 ? readings[readings.length - 1] : undefined;
  const hasTemp = readings.some((r) => r.temperature !== undefined);

  return (
    <div className="space-y-4">
      <StepProgress
        currentStep={currentStep}
        totalSteps={totalSteps}
        label={`${schema.testName} progress`}
        accentHex={schema.accentHex}
        elapsedSec={elapsedSec}
        remainingSec={remainingSec}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <AnalogGauge
          id={`g-${schema.id}-v`}
          label="Voltage"
          value={latest?.voltage ?? 0}
          max={limits.maxVoltage}
          unit="V"
        />
        <AnalogGauge
          id={`g-${schema.id}-i`}
          label="Current"
          value={latest?.current ?? 0}
          max={limits.maxCurrent}
          unit="A"
        />
        <AnalogGauge
          id={`g-${schema.id}-p`}
          label="Power"
          value={latest?.power ?? 0}
          max={limits.maxPower}
          unit="W"
        />
        {latest?.temperature !== undefined && (
          <AnalogGauge
            id={`g-${schema.id}-t`}
            label="Temperature"
            value={latest.temperature}
            max={limits.maxTemp ?? 100}
            unit="°C"
          />
        )}
      </div>

      {derivedStats.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {derivedStats.map((s) => (
            <div
              key={s.label}
              className="bg-gray-900 rounded-lg p-3 border border-gray-700"
            >
              <p className="text-xs text-gray-500">{s.label}</p>
              <p
                className={`text-lg font-mono font-bold ${s.color ?? 'text-white'}`}
              >
                {s.value}{' '}
                <span className="text-xs font-normal text-gray-400">{s.unit}</span>
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LiveChart
          readings={readings as LiveReading[]}
          metric="voltage"
          color="#60a5fa"
          label="Voltage (V)"
        />
        <LiveChart
          readings={readings as LiveReading[]}
          metric="current"
          color="#34d399"
          label="Current (A)"
        />
        <LiveChart
          readings={readings as LiveReading[]}
          metric="power"
          color="#f59e0b"
          label="Power (W)"
        />
        {hasTemp && (
          <LiveChart
            readings={readings as LiveReading[]}
            metric="temperature"
            color="#f87171"
            label="Temperature (°C)"
          />
        )}
      </div>
    </div>
  );
}
