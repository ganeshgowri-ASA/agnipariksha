'use client';

import { useCallback, useState } from 'react';
import {
  Play, Pause, Square, OctagonAlert, RefreshCw, Settings, Activity, Table2, BarChart3, FileText,
  ShieldCheck,
} from 'lucide-react';
import type { TestSession, TestStatus, LiveReading } from '@/types/test-session';
import LiveChart from './LiveChart';
import AnalogGauge from './AnalogGauge';
import DataTable from './DataTable';
import ReportGenerator from './ReportGenerator';
import AnalysisPanel from './AnalysisPanel';
import NameplatePanel from './NameplatePanel';
import { useNotifications } from './notifications/NotificationsStore';
import { getCurrentModuleId, markNameplateUsed } from '@/lib/nameplate-store';

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
  /**
   * Optional preflight / readiness panel. When provided, a "Basic Check"
   * sub-tab is prepended and selected by default — operator verifies
   * connection + manual set + readiness before any cyclic run.
   * Currently used by Thermal Cycling (per the operator UX spec); other
   * IEC tabs continue to default to "Live Monitor" unchanged.
   */
  basicCheckPanel?: React.ReactNode;
  extraStats?: Array<{ label: string; value: string; unit: string; color?: string }>;
  onStartTest: () => void;
  onStopTest: () => void;
  onPauseTest: () => void;
  onResumeTest?: () => void;
  onEmergencyStop?: () => void;
}

type SubTab = 'basic-check' | 'setup' | 'monitor' | 'data' | 'analysis' | 'report';

const BASIC_CHECK_TAB = { key: 'basic-check' as const, label: 'Basic Check', icon: ShieldCheck };
const SUB_TABS_BASE: Array<{ key: Exclude<SubTab, 'basic-check'>; label: string; icon: typeof Settings }> = [
  { key: 'setup',    label: 'Setup',        icon: Settings },
  { key: 'monitor',  label: 'Live Monitor', icon: Activity },
  { key: 'data',     label: 'Data Table',   icon: Table2 },
  { key: 'analysis', label: 'Analysis',     icon: BarChart3 },
  { key: 'report',   label: 'Report',       icon: FileText },
];

async function postControl(testId: string, action: string): Promise<void> {
  try {
    await fetch(`/api/tests/${encodeURIComponent(testId)}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  } catch {
    /* surfaced via notifications by callers */
  }
}

export default function TestTabLayout({
  testKey, testName, standard, color, readings, session,
  onSessionUpdate, sendCommand, demoMode,
  limits, setupPanel, basicCheckPanel, extraStats = [],
  onStartTest, onStopTest, onPauseTest, onResumeTest, onEmergencyStop,
}: TestTabLayoutProps) {
  // When basicCheckPanel is provided, prepend Basic Check and default to
  // it so the operator runs preflight before the cyclic test. Other
  // tabs (HF / DH / BDT / RCO / GCT / LeTID) keep the legacy
  // "Live Monitor" default — no behaviour change for them.
  const subTabs: Array<{ key: SubTab; label: string; icon: typeof Settings }> = basicCheckPanel
    ? [BASIC_CHECK_TAB, ...SUB_TABS_BASE]
    : [...SUB_TABS_BASE];
  const [subTab, setSubTab] = useState<SubTab>(basicCheckPanel ? 'basic-check' : 'monitor');
  const { push } = useNotifications();

  const latest = readings[readings.length - 1];
  const sessionReadings = session?.readings || [];

  const statusColor: Record<TestStatus, string> = {
    idle:    'text-gray-400',
    running: 'text-green-400 animate-pulse',
    paused:  'text-yellow-400',
    pass:    'text-green-400',
    fail:    'text-red-400',
    aborted: 'text-gray-500',
  };

  const isRunning = session?.status === 'running';
  const isPaused  = session?.status === 'paused';

  const fireControl = useCallback(
    (action: 'start' | 'pause' | 'resume' | 'stop' | 'emergency_stop') => {
      if (session?.id) void postControl(session.id, action);
    },
    [session?.id],
  );

  const handleStart = () => {
    onStartTest();
    markNameplateUsed(getCurrentModuleId());
    push({ severity: 'info', source: 'user', title: `Started ${testName}`, message: standard });
    fireControl('start');
  };
  const handlePause = () => {
    onPauseTest();
    push({ severity: 'warning', source: 'user', title: `${testName} paused`, message: 'Awaiting resume' });
    fireControl('pause');
  };
  const handleResume = () => {
    if (!session) return;
    if (onResumeTest) onResumeTest();
    else onSessionUpdate({ ...session, status: 'running' });
    push({ severity: 'info', source: 'user', title: `${testName} resumed`, message: '' });
    fireControl('resume');
  };
  const handleStop = () => {
    onStopTest();
    push({ severity: 'info', source: 'user', title: `${testName} stopped`, message: '' });
    fireControl('stop');
  };
  const handleEStop = () => {
    sendCommand('OUTP OFF');
    sendCommand('SYST:LOC');
    if (onEmergencyStop) onEmergencyStop();
    else if (session) onSessionUpdate({ ...session, status: 'aborted', endTime: Date.now() });
    push({
      severity: 'error', source: 'system',
      title: `EMERGENCY STOP — ${testName}`,
      message: 'Output disabled, instrument returned to local',
    });
    fireControl('emergency_stop');
  };

  return (
    <div className="flex flex-col h-full bg-gray-950" data-testid={`test-tab-${testKey}`}>
      {/* Test Header + control bar */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-sm font-bold ${color}`}>{testName}</span>
          <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{standard}</span>
          {session && (
            <span className={`text-xs font-medium ${statusColor[session.status]}`}>
              ● {session.status.toUpperCase()}
            </span>
          )}
          {demoMode && <span className="text-[10px] text-yellow-400 bg-yellow-900/30 px-1.5 py-0.5 rounded">DEMO</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ControlBtn label="Start"   icon={Play}         onClick={handleStart}  disabled={isRunning} variant="green" />
          <ControlBtn label="Pause"   icon={Pause}        onClick={handlePause}  disabled={!isRunning} variant="yellow" />
          <ControlBtn label="Resume"  icon={RefreshCw}    onClick={handleResume} disabled={!isPaused} variant="blue" />
          <ControlBtn label="Stop"    icon={Square}       onClick={handleStop}   disabled={!session || session.status === 'idle'} variant="red" />
          <ControlBtn label="E-STOP"  icon={OctagonAlert} onClick={handleEStop}  disabled={!session} variant="estop" />
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900 overflow-x-auto" role="tablist" data-testid="subtab-list">
        {subTabs.map(({ key, label, icon: Icon }) => {
          const active = subTab === key;
          return (
            <button
              key={key} type="button"
              onClick={() => setSubTab(key)}
              role="tab"
              aria-selected={active}
              data-testid={`subtab-${key}`}
              data-state={active ? 'active' : 'inactive'}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                active
                  ? 'border-orange-400 text-white bg-gray-800/50'
                  : 'border-transparent text-gray-500 hover:text-gray-200'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Sub-tab Content */}
      <div className="flex-1 overflow-auto p-4">
        {subTab === 'basic-check' && basicCheckPanel && (
          <div className="max-w-5xl" data-testid="subtab-pane-basic-check">{basicCheckPanel}</div>
        )}

        {subTab === 'setup' && (
          <div className="max-w-2xl" data-testid="subtab-pane-setup">
            <NameplatePanel />
            {setupPanel}
          </div>
        )}

        {subTab === 'monitor' && (
          <div className="space-y-4" data-testid="subtab-pane-monitor">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <AnalogGauge label="Voltage"     value={latest?.voltage ?? 0} max={limits.maxVoltage} unit="V"  color="#60a5fa" />
              <AnalogGauge label="Current"     value={latest?.current ?? 0} max={limits.maxCurrent} unit="A"  color="#34d399" />
              <AnalogGauge label="Power"       value={latest?.power   ?? 0} max={limits.maxPower}   unit="W"  color="#f59e0b" />
              <AnalogGauge label="Temperature" value={latest?.temperature ?? 0} max={limits.maxTemp || 100} unit="°C" color="#f87171" />
            </div>

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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <LiveChart readings={readings} metric="voltage" color="#60a5fa" label="Voltage (V)" />
              <LiveChart readings={readings} metric="current" color="#34d399" label="Current (A)" />
              <LiveChart readings={readings} metric="power"   color="#f59e0b" label="Power (W)" />
              {readings.some(r => r.temperature !== undefined) && (
                <LiveChart readings={readings} metric="temperature" color="#f87171" label="Temperature (°C)" />
              )}
            </div>
          </div>
        )}

        {subTab === 'data' && (
          <div data-testid="subtab-pane-data">
            <DataTable
              readings={sessionReadings.length > 0 ? sessionReadings : readings}
              testName={testName}
            />
          </div>
        )}

        {subTab === 'analysis' && (
          <div data-testid="subtab-pane-analysis">
            <AnalysisPanel session={session} testName={testName} standard={standard} />
          </div>
        )}

        {subTab === 'report' && (
          <div data-testid="subtab-pane-report">
            <ReportGenerator session={session} testName={testName} standard={standard} />
          </div>
        )}
      </div>
    </div>
  );
}

function ControlBtn({
  label, icon: Icon, onClick, disabled, variant,
}: {
  label: string;
  icon: typeof Play;
  onClick: () => void;
  disabled?: boolean;
  variant: 'green' | 'yellow' | 'blue' | 'red' | 'estop';
}) {
  const cls = {
    green:  'bg-green-700 hover:bg-green-600',
    yellow: 'bg-yellow-700 hover:bg-yellow-600',
    blue:   'bg-blue-700 hover:bg-blue-600',
    red:    'bg-red-700 hover:bg-red-600',
    estop:  'bg-red-900 hover:bg-red-800 ring-1 ring-red-500/60',
  }[variant];
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1 px-2.5 py-1 text-white text-xs rounded font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}
