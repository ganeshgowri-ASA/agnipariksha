'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ThermalCyclingTab from '@/components/tabs/ThermalCyclingTab';
import HumidityFreezeTab from '@/components/tabs/HumidityFreezeTab';
import LeTIDTab from '@/components/tabs/LeTIDTab';
import BypassDiodeTab from '@/components/tabs/BypassDiodeTab';
import ReverseCurrentTab from '@/components/tabs/ReverseCurrentTab';
import GroundContinuityTab from '@/components/tabs/GroundContinuityTab';
import ResultsDashboard from '@/components/tabs/ResultsDashboard';
import AIAssistant from '@/components/tabs/AIAssistant';
import StatusBar from '@/components/StatusBar';
import { useWebSocket } from '@/hooks/useWebSocket';

export type TestStatus = 'idle' | 'running' | 'paused' | 'pass' | 'fail' | 'aborted';

export interface LiveReading {
  timestamp: number;
  voltage: number;
  current: number;
  power: number;
  temperature?: number;
}

export interface TestSession {
  id: string;
  testType: string;
  startTime: number;
  endTime?: number;
  status: TestStatus;
  readings: LiveReading[];
  result?: 'PASS' | 'FAIL';
  notes?: string;
}

export default function AgniparikshaDashboard() {
  const [activeTab, setActiveTab] = useState('tc');
  const [sessions, setSessions] = useState<Record<string, TestSession | null>>({
    tc: null, hf: null, letid: null, bdt: null, rco: null, gct: null,
  });
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [demoMode, setDemoMode] = useState(true);
  const { readings, wsStatus, sendCommand } = useWebSocket(demoMode);

  const handleSessionUpdate = useCallback((tabKey: string, session: TestSession | null) => {
    setSessions(prev => ({ ...prev, [tabKey]: session }));
  }, []);

  const tabConfig = [
    { key: 'tc',    label: 'Thermal Cycling',       short: 'TC',  color: 'text-orange-400',  std: 'IEC 61215 MQT11' },
    { key: 'hf',    label: 'Humidity Freeze',        short: 'HF',  color: 'text-blue-400',    std: 'IEC 61215 MQT12' },
    { key: 'letid', label: 'LeTID',                  short: 'LID', color: 'text-purple-400',  std: 'IEC TS 63342' },
    { key: 'bdt',   label: 'Bypass Diode',           short: 'BDT', color: 'text-yellow-400',  std: 'IEC 62979' },
    { key: 'rco',   label: 'Reverse Current',        short: 'RCO', color: 'text-red-400',     std: 'IEC 61730 MST26' },
    { key: 'gct',   label: 'Ground Continuity',      short: 'GCT', color: 'text-green-400',   std: 'IEC 61730 MST13' },
  ];

  const statusCounts = {
    running: Object.values(sessions).filter(s => s?.status === 'running').length,
    pass: Object.values(sessions).filter(s => s?.status === 'pass').length,
    fail: Object.values(sessions).filter(s => s?.status === 'fail').length,
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center text-white font-bold text-sm">🔥</div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">Agnipariksha</h1>
            <p className="text-xs text-gray-400">PV Reliability Test Station · ITECH PV6000 · v1.0.0</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 bg-blue-900/50 text-blue-300 rounded">{statusCounts.running} Running</span>
            <span className="px-2 py-1 bg-green-900/50 text-green-300 rounded">{statusCounts.pass} Pass</span>
            <span className="px-2 py-1 bg-red-900/50 text-red-300 rounded">{statusCounts.fail} Fail</span>
          </div>
          <button
            onClick={() => setDemoMode(!demoMode)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              demoMode ? 'bg-yellow-600 text-yellow-100' : 'bg-gray-700 text-gray-300'
            }`}
          >
            {demoMode ? '🎭 DEMO MODE' : '🔌 LIVE'}
          </button>
          <div className={`w-3 h-3 rounded-full ${
            wsStatus === 'connected' ? 'bg-green-400 animate-pulse' : 'bg-red-400'
          }`} title={wsStatus} />
        </div>
      </header>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="bg-gray-900 border-b border-gray-700 rounded-none px-4 h-12 gap-1 justify-start">
          {tabConfig.map(tab => {
            const session = sessions[tab.key];
            const statusDot = session?.status === 'running' ? '🟢' :
                              session?.status === 'pass' ? '✅' :
                              session?.status === 'fail' ? '❌' : '';
            return (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                className={`data-[state=active]:bg-gray-700 data-[state=active]:text-white text-gray-400 px-3 py-1 rounded text-xs font-medium transition-all`}
              >
                <span className={tab.color}>{tab.short}</span>
                <span className="hidden sm:inline ml-1 text-gray-300">{statusDot}</span>
              </TabsTrigger>
            );
          })}
          <TabsTrigger value="results" className="data-[state=active]:bg-gray-700 text-gray-400 px-3 py-1 rounded text-xs ml-auto">
            📊 Results
          </TabsTrigger>
          <TabsTrigger value="ai" className="data-[state=active]:bg-gray-700 text-gray-400 px-3 py-1 rounded text-xs">
            🤖 AI
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto">
          <TabsContent value="tc" className="mt-0 h-full">
            <ThermalCyclingTab readings={readings} session={sessions.tc} onSessionUpdate={(s) => handleSessionUpdate('tc', s)} sendCommand={sendCommand} demoMode={demoMode} />
          </TabsContent>
          <TabsContent value="hf" className="mt-0 h-full">
            <HumidityFreezeTab readings={readings} session={sessions.hf} onSessionUpdate={(s) => handleSessionUpdate('hf', s)} sendCommand={sendCommand} demoMode={demoMode} />
          </TabsContent>
          <TabsContent value="letid" className="mt-0 h-full">
            <LeTIDTab readings={readings} session={sessions.letid} onSessionUpdate={(s) => handleSessionUpdate('letid', s)} sendCommand={sendCommand} demoMode={demoMode} />
          </TabsContent>
          <TabsContent value="bdt" className="mt-0 h-full">
            <BypassDiodeTab readings={readings} session={sessions.bdt} onSessionUpdate={(s) => handleSessionUpdate('bdt', s)} sendCommand={sendCommand} demoMode={demoMode} />
          </TabsContent>
          <TabsContent value="rco" className="mt-0 h-full">
            <ReverseCurrentTab readings={readings} session={sessions.rco} onSessionUpdate={(s) => handleSessionUpdate('rco', s)} sendCommand={sendCommand} demoMode={demoMode} />
          </TabsContent>
          <TabsContent value="gct" className="mt-0 h-full">
            <GroundContinuityTab readings={readings} session={sessions.gct} onSessionUpdate={(s) => handleSessionUpdate('gct', s)} sendCommand={sendCommand} demoMode={demoMode} />
          </TabsContent>
          <TabsContent value="results" className="mt-0 h-full">
            <ResultsDashboard sessions={sessions} />
          </TabsContent>
          <TabsContent value="ai" className="mt-0 h-full">
            <AIAssistant sessions={sessions} readings={readings} />
          </TabsContent>
        </div>
      </Tabs>

      <StatusBar wsStatus={wsStatus} demoMode={demoMode} sessions={sessions} />
    </div>
  );
}
