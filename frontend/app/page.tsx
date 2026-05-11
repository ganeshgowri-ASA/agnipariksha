'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AppHeader } from '@/components/shell/AppHeader';
import { StatusFooter } from '@/components/shell/StatusFooter';
import { useWebSocket } from '@/hooks/useWebSocket';
import { TAB_DESCRIPTORS, type TabKey } from '@/lib/types';
import { cn } from '@/lib/utils';

import ThermalCyclingTab from '@/components/tabs/ThermalCyclingTab';
import HumidityFreezeTab from '@/components/tabs/HumidityFreezeTab';
import LeTIDTab from '@/components/tabs/LeTIDTab';
import BypassDiodeTab from '@/components/tabs/BypassDiodeTab';
import ReverseCurrentTab from '@/components/tabs/ReverseCurrentTab';
import GroundContinuityTab from '@/components/tabs/GroundContinuityTab';
import ResultsTab from '@/components/tabs/ResultsTab';
import AIAssistantTab from '@/components/tabs/AIAssistantTab';

const DEVICE_IP   = process.env.NEXT_PUBLIC_DEVICE_IP   || '192.168.200.100';
const DEVICE_PORT = process.env.NEXT_PUBLIC_DEVICE_PORT || '30000';
const INITIAL_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';

export default function AgniparikshaDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>('tc');
  const [demoMode, setDemoMode] = useState<boolean>(INITIAL_DEMO);

  const { readings, wsStatus } = useWebSocket({ demoMode });

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        deviceIp={DEVICE_IP}
        devicePort={DEVICE_PORT}
        wsStatus={wsStatus}
        demoMode={demoMode}
        onToggleDemo={() => setDemoMode((v) => !v)}
      />

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabKey)}
        className="flex-1"
      >
        <TabsList className="flex w-full flex-wrap gap-1 border-b border-steel-700 bg-panel-raised/80 px-4 py-2">
          {TAB_DESCRIPTORS.map((tab) => (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className="flex items-center gap-2"
              title={tab.standard}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', tab.dot)} />
              <span>{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 overflow-auto">
          <TabsContent value="tc"      className="h-full"><ThermalCyclingTab   readings={readings} /></TabsContent>
          <TabsContent value="hf"      className="h-full"><HumidityFreezeTab   readings={readings} /></TabsContent>
          <TabsContent value="letid"   className="h-full"><LeTIDTab            readings={readings} /></TabsContent>
          <TabsContent value="bdt"     className="h-full"><BypassDiodeTab      readings={readings} /></TabsContent>
          <TabsContent value="rco"     className="h-full"><ReverseCurrentTab   readings={readings} /></TabsContent>
          <TabsContent value="gct"     className="h-full"><GroundContinuityTab readings={readings} /></TabsContent>
          <TabsContent value="results" className="h-full"><ResultsTab          readings={readings} /></TabsContent>
          <TabsContent value="ai"      className="h-full"><AIAssistantTab      readings={readings} /></TabsContent>
        </div>
      </Tabs>

      <StatusFooter wsStatus={wsStatus} demoMode={demoMode} bufferDepth={readings.length} />
    </div>
  );
}
