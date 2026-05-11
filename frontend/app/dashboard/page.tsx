import { redirect } from 'next/navigation';

// `/dashboard` is an alias for `/` (the dashboard IS the root page).
// Keep this so deep links and bookmarks resolve cleanly.
export default function DashboardAliasPage(): never {
  redirect('/');
}
