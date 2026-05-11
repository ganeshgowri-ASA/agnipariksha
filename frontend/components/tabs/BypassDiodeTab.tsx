'use client';

import SharedTestTab from '../SharedTestTab';
import { TEST_SCHEMAS } from '@/lib/testSchemas';
import type { LiveReading, TestSession } from '@/app/page';

interface Props {
  readings: LiveReading[];
  session: TestSession | null;
  onSessionUpdate: (s: TestSession | null) => void;
  sendCommand: (cmd: string) => void;
  demoMode: boolean;
}

export default function BypassDiodeTab({
  readings,
  session,
  onSessionUpdate,
  demoMode,
}: Props) {
  return (
    <SharedTestTab
      schema={TEST_SCHEMAS.bdt}
      readings={readings}
      session={session}
      onSessionUpdate={onSessionUpdate}
      demoMode={demoMode}
    />
  );
}
