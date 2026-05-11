'use client';

import { PlaceholderTab } from '@/components/PlaceholderTab';
import type { LiveReading } from '@/lib/types';

export default function BypassDiodeTab({ readings }: { readings?: LiveReading[] }) {
  return (
    <PlaceholderTab
      title="Bypass Diode"
      standard="IEC 62979"
      description="1.35 × Isc forced through the diode for 1 h."
      readings={readings}
    />
  );
}
