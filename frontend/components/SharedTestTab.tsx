'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LiveReading, TestSession, TestStatus } from '@/app/page';
import {
  DEFAULT_MODULE_SPEC,
  type ModuleSpec,
  type TestSchema,
  defaultParams,
} from '@/lib/testSchemas';
import { pauseTest, startTest, stopTest } from '@/lib/testApi';
import SetupForm from './test/SetupForm';
import LiveMonitorPanel from './test/LiveMonitorPanel';
import TanstackDataTable from './test/TanstackDataTable';
import ReportPanel from './test/ReportPanel';

interface SharedTestTabProps {
  schema: TestSchema;
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  demoMode: boolean;
}

type SubTab = 'setup' | 'monitor' | 'data' | 'report';

const SUB_TABS: ReadonlyArray<{ key: SubTab; label: string }> = [
  { key: 'setup', label: '⚙️ Setup' },
  { key: 'monitor', label: '📡 Live Monitor' },
  { key: 'data', label: '📋 Data Table' },
  { key: 'report', label: '📄 Report' },
];

const STATUS_COLOR: Record<TestStatus, string> = {
  idle: 'text-gray-400',
  running: 'text-green-400 animate-pulse',
  paused: 'text-yellow-400',
  pass: 'text-green-400',
  fail: 'text-red-400',
  aborted: 'text-gray-500',
};

export default function SharedTestTab({
  schema,
  readings,
  session,
  onSessionUpdate,
  demoMode,
}: SharedTestTabProps) {
  const [subTab, setSubTab] = useState<SubTab>('setup');
  const [module, setModule] = useState<ModuleSpec>(DEFAULT_MODULE_SPEC);
  const [params, setParams] = useState<Record<string, number>>(() =>
    defaultParams(schema),
  );
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (session?.status !== 'running') return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session?.status]);

  const isRunning = session?.status === 'running';
  const derivedStats = useMemo(
    () => schema.derive(params, module),
    [schema, params, module],
  );

  const elapsedSec = session ? (nowMs - session.startTime) / 1000 : 0;
  const estimatedTotalSec = schema.estimatedDurationSec(params);
  const remainingSec = Math.max(0, estimatedTotalSec - elapsedSec);
  const currentStep = useMemo(() => {
    if (!session || estimatedTotalSec <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, elapsedSec / estimatedTotalSec));
    return Math.min(schema.totalSteps, Math.floor(ratio * schema.totalSteps));
  }, [session, elapsedSec, estimatedTotalSec, schema.totalSteps]);

  const onStart = useCallback(async () => {
    const draft: TestSession = {
      id: `${schema.id.toUpperCase()}-${Date.now()}`,
      testType: schema.id,
      startTime: Date.now(),
      status: 'running',
      readings: [],
    };
    onSessionUpdate(draft);
    if (!demoMode) {
      const res = await startTest({
        testId: schema.id,
        module,
        params,
      });
      if (res.ok && res.data) {
        onSessionUpdate({
          ...draft,
          id: res.data.sessionId,
          startTime: res.data.startedAt,
        });
      }
    }
  }, [schema, module, params, onSessionUpdate, demoMode]);

  const onStop = useCallback(async () => {
    if (!session) return;
    onSessionUpdate({
      ...session,
      status: 'pass',
      result: 'PASS',
      endTime: Date.now(),
    });
    if (!demoMode) {
      await stopTest(schema.id, session.id);
    }
  }, [session, onSessionUpdate, demoMode, schema.id]);

  const onPause = useCallback(async () => {
    if (!session) return;
    onSessionUpdate({ ...session, status: 'paused' });
    if (!demoMode) {
      await pauseTest(schema.id, session.id);
    }
  }, [session, onSessionUpdate, demoMode, schema.id]);

  // Stream live readings into the active session so the data table & report
  // see the full record, not just the live ring buffer.
  useEffect(() => {
    if (!session || session.status !== 'running') return;
    if (readings.length === 0) return;
    const last = readings[readings.length - 1];
    const tail = session.readings[session.readings.length - 1];
    if (tail && tail.timestamp === last.timestamp) return;
    onSessionUpdate({
      ...session,
      readings: [...session.readings, last],
    });
  }, [readings, session, onSessionUpdate]);

  const monitorReadings = session ? session.readings : readings;

  return (
    <div className="flex flex-col h-full bg-gray-950">
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-sm font-bold ${schema.color}`}>
            {schema.testName}
          </span>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
            {schema.standard} · {schema.clause}
          </span>
          {session && (
            <span
              className={`text-xs font-medium ${STATUS_COLOR[session.status]}`}
            >
              ● {session.status.toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onStart}
            disabled={isRunning || module.sampleId.trim().length === 0}
            className="px-3 py-1 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-xs rounded font-medium transition-colors"
          >
            ▶ Start
          </button>
          <button
            onClick={onPause}
            disabled={!isRunning}
            className="px-3 py-1 bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 text-white text-xs rounded font-medium transition-colors"
          >
            ⏸ Pause
          </button>
          <button
            onClick={onStop}
            disabled={!session || session.status === 'idle'}
            className="px-3 py-1 bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white text-xs rounded font-medium transition-colors"
          >
            ■ Stop
          </button>
        </div>
      </div>

      <div className="flex border-b border-gray-800 bg-gray-900">
        {SUB_TABS.map((st) => (
          <button
            key={st.key}
            onClick={() => setSubTab(st.key)}
            className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
              subTab === st.key
                ? 'border-current text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
            style={subTab === st.key ? { color: schema.accentHex } : undefined}
          >
            {st.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {subTab === 'setup' && (
          <div className="max-w-3xl">
            <SetupForm
              schema={schema}
              module={module}
              onModuleChange={setModule}
              params={params}
              onParamsChange={setParams}
              running={isRunning}
              onStart={onStart}
              onStop={onStop}
            />
          </div>
        )}

        {subTab === 'monitor' && (
          <LiveMonitorPanel
            schema={schema}
            readings={monitorReadings}
            limits={schema.limits}
            derivedStats={derivedStats}
            currentStep={currentStep}
            totalSteps={schema.totalSteps}
            elapsedSec={elapsedSec}
            remainingSec={remainingSec}
          />
        )}

        {subTab === 'data' && (
          <TanstackDataTable
            readings={monitorReadings}
            testName={schema.testName}
          />
        )}

        {subTab === 'report' && (
          <ReportPanel schema={schema} session={session} module={module} />
        )}
      </div>
    </div>
  );
}
