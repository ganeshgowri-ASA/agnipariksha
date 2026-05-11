'use client';

import { PlaceholderTab } from '@/components/PlaceholderTab';
import type { LiveReading } from '@/lib/types';

export default function ReverseCurrentTab({ readings }: { readings?: LiveReading[] }) {
  return (
    <PlaceholderTab
      title="Reverse Current Overload"
      standard="IEC 61730 MST26"
      description="135 % of the series-fuse rating injected in reverse for 2 h."
      readings={readings}
    />
  );
}
