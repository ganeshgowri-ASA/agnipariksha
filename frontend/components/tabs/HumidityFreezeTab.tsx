'use client';

import { PlaceholderTab } from '@/components/PlaceholderTab';
import type { LiveReading } from '@/lib/types';

export default function HumidityFreezeTab({ readings }: { readings?: LiveReading[] }) {
  return (
    <PlaceholderTab
      title="Humidity Freeze"
      standard="IEC 61215 MQT12"
      description="85 %RH at +85 °C then ramp to -40 °C across 10 cycles."
      readings={readings}
    />
  );
}
