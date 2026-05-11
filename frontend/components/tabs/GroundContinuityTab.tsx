'use client';

import { PlaceholderTab } from '@/components/PlaceholderTab';
import type { LiveReading } from '@/lib/types';

export default function GroundContinuityTab({ readings }: { readings?: LiveReading[] }) {
  return (
    <PlaceholderTab
      title="Ground Continuity"
      standard="IEC 61730 MST13"
      description="25 A injected, frame-to-ground resistance must stay under 0.1 Ω."
      readings={readings}
    />
  );
}
