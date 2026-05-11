'use client';

import { PlaceholderTab } from '@/components/PlaceholderTab';
import type { LiveReading } from '@/lib/types';

export default function LeTIDTab({ readings }: { readings?: LiveReading[] }) {
  return (
    <PlaceholderTab
      title="LeTID"
      standard="IEC TS 63342"
      description="Idark = Isc − Imp held at 75 °C for 162 h."
      readings={readings}
    />
  );
}
