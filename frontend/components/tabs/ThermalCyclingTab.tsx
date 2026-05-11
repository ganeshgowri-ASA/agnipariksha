'use client';

import { PlaceholderTab } from '@/components/PlaceholderTab';
import type { LiveReading } from '@/lib/types';

export default function ThermalCyclingTab({ readings }: { readings?: LiveReading[] }) {
  return (
    <PlaceholderTab
      title="Thermal Cycling"
      standard="IEC 61215 MQT11"
      description="200 cycles -40 °C to +85 °C with dwell and ramp control."
      readings={readings}
    />
  );
}
