'use client';

import { PlaceholderTab } from '@/components/PlaceholderTab';
import type { LiveReading } from '@/lib/types';

export default function AIAssistantTab({ readings }: { readings?: LiveReading[] }) {
  return (
    <PlaceholderTab
      title="AI Assistant"
      standard="Claude / OpenRouter"
      description="Chat-based assistant for test interpretation and report drafting."
      readings={readings}
    />
  );
}
