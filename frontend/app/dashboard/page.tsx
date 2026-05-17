'use client';

import { useCallback, useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ThermalCyclingTab from '@/components/tabs/ThermalCyclingTab';
import HumidityFreezeTab from '@/components/tabs/HumidityFreezeTab';
import LeTIDTab from '@/components/tabs/LeTIDTab';
import BypassDiodeTab from '@/components/tabs/BypassDiodeTab';
import ReverseCurrentTab from '@/components/tabs/ReverseCurrentTab';
import GroundContinuityTab from '@/components/tabs/GroundContinuityTab';
import DampHeatTab from '@/components/tabs/DampHeatTab';
import ResultsDashboard from '@/components/ResultsDashboard';
import AIAssistant from '@/components/AIAssistant';
import StatusBar from '@/components/StatusBar';
import AppHeader from '@/components/AppHeader';
import DevicePills from '@/components/DevicePills';
import { ModuleIdProvider } from '@/components/ModuleIdContext';
import { NotificationsProvider } from '@/components/notifications/NotificationsStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { TABS, type TestKey, type TestSession } from '@/types/test-session';

function Dashboard() {
  const [activeTab, setActiveTab] = useState<string>('tc');
  const [sessions, setSessions] = useState<Record<TestKey, TestSession | null>>({
    tc: null, hf: null, letid: null, bdt: null, rco: null, gct: null, dh: null,
  });
  const [demoMode, setDemoMode] = useState(true);
  const { readings, wsStatus, sendCommand } = useWebSocket(demoMode);

  // Honour ?tab=<key> from deep-link redirects (e.g. /tests/damp-heat).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search).get('tab');
    if (!t) return;
    const valid = new Set([...TABS.map(x => x.key), 'results', 'ai']);
    if (valid.has(t as TestKey)) setActiveTab(t);
  }, []);

  const handleSessionUpdate = useCallback((tabKey: TestKey, session: TestSession | null) => {
    setSessions(prev => ({ ...prev, [tabKey]: session }));
  }, []);

  const statusCounts = {
    running: Object.values(sessions).filter(s => s?.status === 'running').length,
    pass:    Object.values(sessions).filter(s => s?.status === 'pass').length,
    fail:    Object.values(sessions).filter(s => s?.status === 'fail').length,
  };

  const tabRender: Record<TestKey, React.ReactNode> = {
    tc:    <ThermalCyclingTab     readings={readings} session={sessions.tc}    onSessionUpdate={s => handleSessionUpdate('tc',    s)} sendCommand={sendCommand} demoMode={demoMode} wsStatus={wsStatus} />,
    hf:    <HumidityFreezeTab     readings={readings} session={sessions.hf}    onSessionUpdate={s => handleSessionUpdate('hf',    s)} sendCommand={sendCommand} demoMode={demoMode} />,
    letid: <LeTIDTab              readings={readings} session={sessions.letid} onSessionUpdate={s => handleSessionUpdate('letid', s)} sendCommand={sendCommand} demoMode={demoMode} />,
    bdt:   <BypassDiodeTab        readings={readings} session={sessions.bdt}   onSessionUpdate={s => handleSessionUpdate('bdt',   s)} sendCommand={sendCommand} demoMode={demoMode} />,
    rco:   <ReverseCurrentTab     readings={readings} session={sessions.rco}   onSessionUpdate={s => handleSessionUpdate('rco',   s)} sendCommand={sendCommand} demoMode={demoMode} />,
    gct:   <GroundContinuityTab   readings={readings} session={sessions.gct}   onSessionUpdate={s => handleSessionUpdate('gct',   s)} sendCommand={sendCommand} demoMode={demoMode} />,
    dh:    <DampHeatTab           readings={readings} session={sessions.dh}    onSessionUpdate={s => handleSessionUpdate('dh',    s)} sendCommand={sendCommand} demoMode={demoMode} />,
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <AppHeader
        wsStatus={wsStatus}
        demoMode={demoMode}
        onToggleDemo={() => setDemoMode(d => !d)}
        statusCounts={statusCounts}
      />

      <div className="bg-gray-950/60 border-b border-gray-800 px-6 py-2 flex items-center gap-3 overflow-x-auto">
        <span className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Devices</span>
        <DevicePills />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="bg-gray-900 border-b border-gray-700 rounded-none px-3 h-11 gap-1 justify-start overflow-x-auto">
          {TABS.map(tab => {
            const session = sessions[tab.key];
            const dot =
              session?.status === 'running' ? '●' :
              session?.status === 'pass'    ? '✓' :
              session?.status === 'fail'    ? '✗' : '';
            return (
              <TabsTrigger
                key={tab.key} value={tab.key}
                className="data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-400 px-3 py-1 rounded text-xs font-medium transition-all whitespace-nowrap"
                title={tab.std}
              >
                <span className={tab.color}>{tab.short}</span>
                <span className="ml-1 hidden sm:inline text-gray-300">{tab.label}</span>
                {dot && <span className="ml-1 text-gray-300">{dot}</span>}
              </TabsTrigger>
            );
          })}
          <TabsTrigger
            value="results"
            className="data-[state=active]:bg-gray-800 text-gray-400 px-3 py-1 rounded text-xs ml-auto whitespace-nowrap"
          >
            Results
          </TabsTrigger>
          <TabsTrigger
            value="ai"
            className="data-[state=active]:bg-gray-800 text-gray-400 px-3 py-1 rounded text-xs whitespace-nowrap"
          >
            AI
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto">
          {TABS.map(tab => (
            <TabsContent key={tab.key} value={tab.key} className="mt-0 h-full">
              {tabRender[tab.key]}
            </TabsContent>
          ))}
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

export default function AgniparikshaDashboard() {
  return (
    <NotificationsProvider>
      <ModuleIdProvider>
        <Dashboard />
      </ModuleIdProvider>
    </NotificationsProvider>
  );
}
