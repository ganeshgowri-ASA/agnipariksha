'use client';

import { useState } from 'react';
import type { TestSession, TestStatus, LiveReading } from '@/types/test-session';
import LiveChart from './LiveChart';
import AnalogGauge from './AnalogGauge';
import DataTable from './DataTable';
import ReportGenerator from './ReportGenerator';

interface TestTabLayoutProps {
  testKey: string;
  testName: string;
  standard: string;
  color: string;
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
  limits: { maxVoltage: number; maxCurrent: number; maxPower: number; maxTemp?: number };
  setupPanel: React.ReactNode;
  extraStats?: Array<{ label: string; value: string; unit: string; color?: string }>;
  onStartTest: () => void;
  onStopTest: () => void;
  onPauseTest: () => void;
}

type SubTab = 'setup' | 'monitor' | 'data' | 'report';

export default function TestTabLayout({
  testKey, testName, standard, color, readings, session,
  limits, setupPanel, extraStats = [], onStartTest, onStopTest, onPauseTest, demoMode,
}: TestTabLayoutProps) {
  const [subTab, setSubTab] = useState<SubTab>('monitor');

  const latest = readings[readings.length - 1];
  const sessionReadings = session?.readings || [];

  const statusColor: Record<TestStatus, string> = {
    idle: 'text-gray-400', running: 'text-green-400 animate-pulse',
    paused: 'text-yellow-400', pass: 'text-green-400',
    fail: 'text-red-400', aborted: 'text-gray-500',
  };

  const subTabs: SubTab[] = ['setup', 'monitor', 'data', 'report'];

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Test Header */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-sm font-bold ${color}`}>{testName}</span>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{standard}</span>
          {session && (
            <span className={`text-xs font-medium ${statusColor[session.status]}`}>
              ● {session.status.toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onStartTest} disabled={session?.status === 'running'}
            className="px-3 py-1 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-xs rounded font-medium transition-colors">
            ▶ Start
          </button>
          <button onClick={onPauseTest} disabled={session?.status !== 'running'}
            className="px-3 py-1 bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 text-white text-xs rounded font-medium transition-colors">
            ⏸ Pause
          </button>
          <button onClick={onStopTest} disabled={!session || session.status === 'idle'}
            className="px-3 py-1 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-xs rounded font-medium transition-colors">
            ■ Stop
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900">
        {subTabs.map(st => (
          <button key={st} onClick={() => setSubTab(st)}
            className={`px-4 py-2 text-xs capitalize font-medium transition-colors border-b-2 ${
              subTab === st ? `border-${color.split('-')[1]}-400 text-white` : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            {st === 'setup' ? '⚙️ Setup' : st === 'monitor' ? '📡 Live Monitor' : st === 'data' ? '📋 Data Table' : '📄 Report'}
          </button>
        ))}
      </div>

      {/* Sub-tab Content */}
      <div className="flex-1 overflow-auto p-4">
        {subTab === 'setup' && (
          <div className="max-w-2xl">{setupPanel}</div>
        )}

        {subTab === 'monitor' && (
          <div className="space-y-4">
            {/* Gauges Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <AnalogGauge label="Voltage" value={latest?.voltage || 0} max={limits.maxVoltage} unit="V" color="#60a5fa" />
              <AnalogGauge label="Current" value={latest?.current || 0} max={limits.maxCurrent} unit="A" color="#34d399" />
              <AnalogGauge label="Power" value={latest?.power || 0} max={limits.maxPower} unit="W" color="#f59e0b" />
              {latest?.temperature !== undefined && (
                <AnalogGauge label="Temperature" value={latest.temperature} max={limits.maxTemp || 100} unit="°C" color="#f87171" />
              )}
            </div>

            {/* Extra stats */}
            {extraStats.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {extraStats.map(s => (
                  <div key={s.label} className="bg-gray-900 rounded-lg p-3 border border-gray-700">
                    <p className="text-xs text-gray-500">{s.label}</p>
                    <p className={`text-xl font-mono font-bold ${s.color || 'text-white'}`}>
                      {s.value} <span className="text-xs font-normal text-gray-400">{s.unit}</span>
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Live Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <LiveChart readings={readings} metric="voltage" color="#60a5fa" label="Voltage (V)" />
              <LiveChart readings={readings} metric="current" color="#34d399" label="Current (A)" />
              <LiveChart readings={readings} metric="power" color="#f59e0b" label="Power (W)" />
              {readings.some(r => r.temperature !== undefined) && (
                <LiveChart readings={readings} metric="temperature" color="#f87171" label="Temperature (°C)" />
              )}
            </div>
          </div>
        )}

        {subTab === 'data' && (
          <DataTable readings={sessionReadings.length > 0 ? sessionReadings : readings} testName={testName} />
        )}

        {subTab === 'report' && (
          <ReportGenerator session={session} testName={testName} standard={standard} />
        )}
      </div>
    </div>
  );
}
