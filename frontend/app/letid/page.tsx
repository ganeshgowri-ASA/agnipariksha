import { redirect } from 'next/navigation';

// Canonical LeTID route (IEC TS 63342). The legacy /lid path is 308'd here
// via next.config redirects; this lands operators on the dashboard tab.
export default function LetidPage(): never {
  redirect('/dashboard?tab=letid');
}
