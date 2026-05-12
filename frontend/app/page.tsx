import { redirect } from 'next/navigation';

// V2-S8: /overview is the default landing surface.
// The legacy tabbed dashboard lives at /dashboard.
export default function RootPage(): never {
  redirect('/overview');
}
