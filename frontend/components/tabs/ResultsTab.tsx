'use client';

import { PlaceholderTab } from '@/components/PlaceholderTab';
import type { LiveReading } from '@/lib/types';

export default function ResultsTab({ readings }: { readings?: LiveReading[] }) {
  return (
    <PlaceholderTab
      title="Results"
      standard="Reports & Exports"
      description="Aggregated session results, pass/fail summaries, and report export."
      readings={readings}
    />
  );
}
