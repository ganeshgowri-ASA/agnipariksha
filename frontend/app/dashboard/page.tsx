'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { NotificationsProvider } from '@/components/notifications/NotificationsStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { TABS, type TestKey, type TestSession } from '@/types/test-session';

// Tabs that stay visible at narrow widths; the rest collapse into "More".
const MOBILE_VISIBLE: TestKey[] = ['tc', 'hf'];

function Dashboard() {
  const [activeTab, setActiveTab] = useState<string>('tc');
  const [moreOpen, setMoreOpen] = useState(false);
  const [aiSheetOpen, setAiSheetOpen] = useState(false);
  const [sessions, setSessions] = useState<Record<TestKey, TestSession | null>>({
    tc: null, hf: null, letid: null, bdt: null, rco: null, gct: null, dh: null,
  });
  const [demoMode, setDemoMode] = useState(true);
  const { readings, wsStatus, sendCommand } = useWebSocket(demoMode);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search).get('tab');
    if (!t) return;
    const valid = new Set([...TABS.map(x => x.key), 'results', 'ai']);
    if (valid.has(t as TestKey)) setActiveTab(t);
  }, []);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (!moreRef.current) return;
      if (!moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    if (moreOpen) {
      document.addEventListener('mousedown', close);
      return () => document.removeEventListener('mousedown', close);
    }
  }, [moreOpen]);

  const handleSessionUpdate = useCallback((tabKey: TestKey, session: TestSession | null) => {
    setSessions(prev => ({ ...prev, [tabKey]: session }));
  }, []);

  const statusCounts = {
    running: Object.values(sessions).filter(s => s?.status === 'running').length,
    pass:    Object.values(sessions).filter(s => s?.status === 'pass').length,
    fail:    Object.values(sessions).filter(s => s?.status === 'fail').length,
  };

  const tabRender: Record<TestKey, React.ReactNode> = {
    tc:    <ThermalCyclingTab     readings={readings} session={sessions.tc}    onSessionUpdate={s => handleSessionUpdate('tc',    s)} sendCommand={sendCommand} demoMode={demoMode} />,
    hf:    <HumidityFreezeTab     readings={readings} session={sessions.hf}    onSessionUpdate={s => handleSessionUpdate('hf',    s)} sendCommand={sendCommand} demoMode={demoMode} />,
    letid: <LeTIDTab              readings={readings} session={sessions.letid} onSessionUpdate={s => handleSessionUpdate('letid', s)} sendCommand={sendCommand} demoMode={demoMode} />,
    bdt:   <BypassDiodeTab        readings={readings} session={sessions.bdt}   onSessionUpdate={s => handleSessionUpdate('bdt',   s)} sendCommand={sendCommand} demoMode={demoMode} />,
    rco:   <ReverseCurrentTab     readings={readings} session={sessions.rco}   onSessionUpdate={s => handleSessionUpdate('rco',   s)} sendCommand={sendCommand} demoMode={demoMode} />,
    gct:   <GroundContinuityTab   readings={readings} session={sessions.gct}   onSessionUpdate={s => handleSessionUpdate('gct',   s)} sendCommand={sendCommand} demoMode={demoMode} />,
    dh:    <DampHeatTab           readings={readings} session={sessions.dh}    onSessionUpdate={s => handleSessionUpdate('dh',    s)} sendCommand={sendCommand} demoMode={demoMode} />,
  };

  const hiddenTabs = TABS.filter(t => !MOBILE_VISIBLE.includes(t.key));

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
        <TabsList
          data-testid="primary-tablist"
          className="bg-gray-900 border-b border-gray-700 rounded-none px-2 sm:px-3 h-11 gap-1 justify-start overflow-x-auto"
        >
          {TABS.map(tab => {
            const session = sessions[tab.key];
            const dot =
              session?.status === 'running' ? '●' :
              session?.status === 'pass'    ? '✓' :
              session?.status === 'fail'    ? '✗' : '';
            const hideOnMobile = !MOBILE_VISIBLE.includes(tab.key);
            return (
              <TabsTrigger
                key={tab.key} value={tab.key}
                className={`data-[state=active]:bg-gray-800 data-[state=active]:text-white text-gray-400 px-3 py-1 rounded text-xs font-medium transition-all whitespace-nowrap ${
                  hideOnMobile ? 'hidden md:inline-flex' : ''
                }`}
                title={tab.std}
                data-tab-key={tab.key}
              >
                <span className={tab.color}>{tab.short}</span>
                <span className="ml-1 hidden sm:inline text-gray-300">{tab.label}</span>
                {dot && <span className="ml-1 text-gray-300">{dot}</span>}
              </TabsTrigger>
            );
          })}

          <div ref={moreRef} className="md:hidden relative">
            <button
              type="button"
              data-testid="more-tabs-button"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(o => !o)}
              className="px-3 py-1 rounded text-xs font-medium text-gray-300 hover:bg-gray-800"
            >
              More ▾
            </button>
            {moreOpen && (
              <div
                role="menu"
                data-testid="more-tabs-menu"
                className="absolute left-0 z-40 mt-1 w-44 rounded border border-gray-700 bg-gray-900 shadow-lg"
              >
                {hiddenTabs.map(t => (
                  <button
                    key={t.key}
                    role="menuitem"
                    data-tab-key={t.key}
                    onClick={() => { setActiveTab(t.key); setMoreOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-800 ${activeTab === t.key ? 'bg-gray-800' : ''}`}
                  >
                    <span className={t.color}>{t.short}</span>
                    <span className="ml-2 text-gray-200">{t.label}</span>
                  </button>
                ))}
                <button
                  role="menuitem"
                  onClick={() => { setActiveTab('results'); setMoreOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-800 ${activeTab === 'results' ? 'bg-gray-800' : ''}`}
                >
                  Results
                </button>
              </div>
            )}
          </div>

          <TabsTrigger
            value="results"
            className="hidden md:inline-flex data-[state=active]:bg-gray-800 text-gray-400 px-3 py-1 rounded text-xs ml-auto whitespace-nowrap"
          >
            Results
          </TabsTrigger>
          <TabsTrigger
            value="ai"
            className="hidden md:inline-flex data-[state=active]:bg-gray-800 text-gray-400 px-3 py-1 rounded text-xs whitespace-nowrap"
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

      <button
        type="button"
        data-testid="ai-sheet-trigger"
        aria-expanded={aiSheetOpen}
        aria-controls="ai-bottom-sheet"
        onClick={() => setAiSheetOpen(o => !o)}
        className="md:hidden fixed bottom-3 right-3 z-30 rounded-full bg-orange-600 px-4 py-3 text-xs font-semibold text-white shadow-lg shadow-orange-500/30"
      >
        🤖 AI
      </button>
      {aiSheetOpen && (
        <div
          id="ai-bottom-sheet"
          role="dialog"
          aria-modal="true"
          data-testid="ai-bottom-sheet"
          className="md:hidden fixed inset-x-0 bottom-0 z-40 max-h-[80vh] overflow-auto rounded-t-2xl border-t border-gray-700 bg-gray-950 shadow-2xl"
        >
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
            <h2 className="text-sm font-semibold">AI Assistant</h2>
            <button
              type="button"
              onClick={() => setAiSheetOpen(false)}
              className="rounded px-2 py-1 text-xs hover:bg-gray-800"
              aria-label="Close AI sheet"
            >
              Close
            </button>
          </div>
          <AIAssistant sessions={sessions} readings={readings} />
        </div>
      )}

      <StatusBar wsStatus={wsStatus} demoMode={demoMode} sessions={sessions} />
    </div>
  );
}

export default function AgniparikshaDashboard() {
  return (
    <NotificationsProvider>
      <Dashboard />
    </NotificationsProvider>
  );
}
